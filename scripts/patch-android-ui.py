#!/usr/bin/env python3
"""
Fix two things in the generated Android shell that Capacitor can't do for us.

Run after `npx cap add android`. Like the manifest patcher, this has to run on
every build because android/ is regenerated from scratch each time.

1. LAUNCHER ICON
   resources/icon.png is full-bleed artwork - the mark touches its own canvas
   edge. @capacitor/assets treats a lone icon.png as a "logo", stretches it
   across the entire adaptive-icon foreground and pairs it with a plain white
   background. Android then clips that with the launcher's circle mask, so the
   mark gets its top and bottom shaved off and reads much larger than every
   other icon in the drawer.

   Android's spec: the layer is 108dp, only the middle 72dp is guaranteed
   visible, and artwork belongs inside a ~66dp keyline within that. Supplying
   pre-padded source files to @capacitor/assets doesn't work either - it emits
   them at legacy icon sizes (192px at xxxhdpi instead of 432px), so they get
   upscaled and go soft. So we compose the mipmaps directly here at the right
   densities and write our own adaptive-icon XML.

2. EDGE-TO-EDGE SYSTEM BARS
   By default the WebView is laid out below the status bar, so the app's own
   background stops short of the clock and battery. Modern Android apps draw
   underneath the bars instead. index.html is already written for this (it uses
   env(safe-area-inset-*) throughout), so this only needs the native half:
   transparent bars, decor that doesn't fit system windows, and the real inset
   values pushed into CSS custom properties.

   That last part matters: Android WebView below version 140 has a bug that
   reports env(safe-area-inset-top) as 0 even in edge-to-edge mode. Field
   devices often run older WebViews, so we can't rely on the CSS variable
   alone - MainActivity reads the true insets and hands them to the page, and
   the CSS takes whichever value is larger.

   The status/nav bar ICON color (dark-on-light vs light-on-dark) can't be
   pinned to one value the way the background can, because PlotEdge's own
   background swaps between a near-black dark theme and a light/pink theme
   (index.html's data-theme). A dark icon reads fine on the light theme's
   header but disappears on the dark theme's, and vice versa. So MainActivity
   exposes a tiny JS interface ("AndroidChrome") that index.html's existing
   applyTheme() calls every time the theme changes, flipping the system bar
   icons to match whichever theme is actually on screen.
"""

import pathlib
import re
import sys

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install with: pip install pillow")
    sys.exit(1)

ANDROID = pathlib.Path("android/app/src/main")
RES = ANDROID / "res"
SOURCE_ICON = pathlib.Path("resources/icon.png")

# --grad-1 from index.html's dark theme, so launcher icon, splash and in-app
# header all share one colour.
BRAND_BG = (10, 4, 5, 255)

# Adaptive icon layers are 108dp square. Multiply by each density's scale.
DENSITY_SCALE = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}
ADAPTIVE_DP = 108
LEGACY_DP = 48

# Fraction of the full 108dp layer the artwork's longest side covers. Android publishes
# per-shape keylines inside the 72dp visible area, and the right one depends on the mark's
# proportions: a square mark sits on a 66dp keyline (0.44 of 108dp once you allow for the
# mask), a vertical rectangle on a 44x60dp one. This mark is portrait (roughly 7:10), so
# height is the governing side and 60/108 is the target. Fitting a tall mark to the square
# figure instead makes it read noticeably smaller than neighbouring icons.
ARTWORK_FRACTION = 0.55
# Legacy (pre-Android 8) icons are never masked and get no inset, so the artwork can run
# much closer to the canvas edge - 44dp of the 48dp legacy keyline.
LEGACY_ARTWORK_FRACTION = 0.88

ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/patch-android-ui.py. Padding is baked into the
     foreground PNG, so no <inset> is applied here - and the background layer
     fills all 108dp so no launcher mask can ever clip past its edge. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""

MAIN_ACTIVITY = """package com.plotedge.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Written by scripts/patch-android-ui.py - edits here are overwritten on the
 * next build. Change the script instead.
 *
 * Puts the app in edge-to-edge mode and forwards the real system bar insets to
 * the web layer as CSS custom properties (--sb-top / --sb-bottom / --sb-left /
 * --sb-right). index.html reads those alongside env(safe-area-inset-*) and
 * takes whichever is larger, which covers the Android WebView < 140 bug where
 * the env() values come back as 0.
 */
public class MainActivity extends BridgeActivity {

    private static final int CAMERA_PERMISSION_REQUEST = 8421;
    private String pendingInsetJs = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // AndroidManifest.xml *declares* CAMERA, but on API 23+ that alone
        // does not grant it - the vertex-photo button in index.html routes
        // through Capacitor's Camera plugin (see openVertexPhotoCapture()),
        // which does its own runtime permission check before it can launch
        // the native camera Activity. Asking here too, at launch, means it's
        // already granted by the time the user taps that button, so there's
        // no extra prompt breaking up the capture flow. Also covers the
        // plain <input capture="environment"> fallback used outside the
        // native app, whose WebView file chooser only offers a "take photo"
        // option once CAMERA has actually been granted.
        requestCameraPermissionIfNeeded();

        // Draw behind the status and navigation bars.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Attached to the content view rather than the decor view: replacing the
        // decor view's listener would take over the framework's own inset
        // dispatch, and we only want to observe.
        final View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = getResources().getDisplayMetrics().density;

            pendingInsetJs =
                "document.documentElement.style.setProperty('--sb-top','" +
                Math.round(bars.top / density) + "px');" +
                "document.documentElement.style.setProperty('--sb-bottom','" +
                Math.round(bars.bottom / density) + "px');" +
                "document.documentElement.style.setProperty('--sb-left','" +
                Math.round(bars.left / density) + "px');" +
                "document.documentElement.style.setProperty('--sb-right','" +
                Math.round(bars.right / density) + "px');";

            pushInsets();
            // Returning the insets unconsumed lets the WebView see them too, so
            // env(safe-area-inset-*) still works on WebView 140+.
            return windowInsets;
        });

        // index.html's applyTheme() calls AndroidChrome.setLightStatusBar(...)
        // on every theme change (including the initial one at page load), so
        // the status/nav bar icons always match whichever theme - light/pink
        // or dark - is actually on screen. Added here, before the page starts
        // loading, so it's ready the moment the first script tag runs.
        final WebView bridgeWebView = getBridge() != null ? getBridge().getWebView() : null;
        if (bridgeWebView != null) {
            bridgeWebView.addJavascriptInterface(new StatusBarBridge(), "AndroidChrome");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // The first inset callback usually lands before the page has finished
        // loading, so the properties get set on a document that is then thrown
        // away. Re-applying on resume and on a short delay makes it stick
        // regardless of which order those two finish in.
        pushInsets();
        final View content = findViewById(android.R.id.content);
        if (content != null) {
            content.postDelayed(this::pushInsets, 250);
            content.postDelayed(this::pushInsets, 1200);
        }
    }

    private void pushInsets() {
        if (pendingInsetJs == null || getBridge() == null) {
            return;
        }
        final WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }
        final String js = pendingInsetJs;
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void requestCameraPermissionIfNeeded() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.CAMERA},
                CAMERA_PERMISSION_REQUEST
            );
        }
    }

    /**
     * Bridges index.html's theme switcher to the native status/nav bar icon
     * color. WebView JS-interface methods run on a background thread, so the
     * actual WindowInsetsController call is posted back to the UI thread.
     */
    private class StatusBarBridge {
        @JavascriptInterface
        public void setLightStatusBar(final boolean lightBackground) {
            runOnUiThread(() -> {
                WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                // "Light" here means the SYSTEM BAR BACKGROUND behind the icons is
                // light, so the icons themselves need to render dark to stay
                // visible - i.e. this is Android's "light status bar" flag, which
                // is the same polarity as iOS's dark-content style.
                controller.setAppearanceLightStatusBars(lightBackground);
                controller.setAppearanceLightNavigationBars(lightBackground);
            });
        }
    }
}
"""

# Transparent bars. windowLightStatusBar/windowLightNavigationBar start false
# (light icons) here purely as the first-paint default before any JS has run -
# MainActivity's StatusBarBridge + index.html's applyTheme() immediately
# override this to match whichever theme (light/pink or dark) is active, and
# keep it in sync every time the person switches themes afterward.
EDGE_TO_EDGE_ITEMS = """        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:enforceNavigationBarContrast">false</item>
        <item name="android:enforceStatusBarContrast">false</item>
"""


def trimmed_mark() -> Image.Image:
    """The mark with its transparent margins removed, so scaling is exact."""
    img = Image.open(SOURCE_ICON).convert("RGBA")
    box = img.split()[3].getbbox()
    return img.crop(box) if box else img


def compose(mark: Image.Image, size: int, fraction: float, background) -> Image.Image:
    """Fit the mark into `fraction` of a square canvas, centered, over `background`."""
    target = size * fraction
    ratio = min(target / mark.width, target / mark.height)
    scaled = mark.resize(
        (max(1, round(mark.width * ratio)), max(1, round(mark.height * ratio))),
        Image.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), background)
    canvas.alpha_composite(
        scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2)
    )
    return canvas


def write_icons() -> None:
    if not SOURCE_ICON.exists():
        print(f"  SKIP icons: {SOURCE_ICON} not found")
        return

    mark = trimmed_mark()
    print(f"  source mark {mark.width}x{mark.height} after trim")

    for density, scale in DENSITY_SCALE.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)

        adaptive_px = round(ADAPTIVE_DP * scale)
        legacy_px = round(LEGACY_DP * scale)

        compose(mark, adaptive_px, ARTWORK_FRACTION, (0, 0, 0, 0)).save(
            folder / "ic_launcher_foreground.png"
        )
        Image.new("RGBA", (adaptive_px, adaptive_px), BRAND_BG).save(
            folder / "ic_launcher_background.png"
        )

        legacy = compose(mark, legacy_px, LEGACY_ARTWORK_FRACTION, BRAND_BG)
        legacy.save(folder / "ic_launcher.png")
        legacy.save(folder / "ic_launcher_round.png")

        print(f"  {density}: adaptive {adaptive_px}px, legacy {legacy_px}px")

    anydpi = RES / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(ADAPTIVE_XML, encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(ADAPTIVE_XML, encoding="utf-8")
    print("  wrote adaptive-icon XML (background fills the full 108dp layer)")


def write_main_activity() -> None:
    matches = list(pathlib.Path("android/app/src/main/java").rglob("MainActivity.java"))
    if not matches:
        print("  SKIP MainActivity: not found")
        return
    for path in matches:
        path.write_text(MAIN_ACTIVITY, encoding="utf-8")
        print(f"  rewrote {path}")


def patch_styles() -> None:
    styles = RES / "values" / "styles.xml"
    if not styles.exists():
        print("  SKIP styles.xml: not found")
        return

    xml = styles.read_text(encoding="utf-8")
    if "windowLightStatusBar" in xml:
        print("  styles.xml already patched")
        return

    # AppTheme.NoActionBar is the theme MainActivity actually runs under once
    # the splash screen hands off.
    pattern = re.compile(
        r'(<style name="AppTheme\.NoActionBar"[^>]*>\n)', re.MULTILINE
    )
    patched, count = pattern.subn(r"\1" + EDGE_TO_EDGE_ITEMS, xml)
    if not count:
        print("  WARNING: could not find AppTheme.NoActionBar - styles.xml unchanged")
        return

    styles.write_text(patched, encoding="utf-8")
    print("  patched styles.xml for transparent system bars")


def main() -> int:
    if not ANDROID.exists():
        print(f"ERROR: {ANDROID} not found - run after `npx cap add android`.")
        return 1

    print("Launcher icons:")
    write_icons()
    print("Edge-to-edge:")
    patch_styles()
    write_main_activity()
    return 0


if __name__ == "__main__":
    sys.exit(main())
