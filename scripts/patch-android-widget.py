#!/usr/bin/env python3
"""
Inject PlotEdge's home screen widget into the Android project that
`npx cap add android` generates.

WHY THIS IS A BUILD-TIME PATCH
------------------------------
The android/ folder is not committed - it is regenerated from scratch on every
CI run - so anything native has to be re-injected each build. This follows the
same pattern as patch-android-manifest.py and patch-android-ui.py.

WHAT THE WIDGET SHOWS
---------------------
An at-a-glance field status card: the active project, its feature count, how
many vertices are mid-capture, and how many projects still hold unexported
data. The point is answering "is there work on this phone I haven't got off it
yet?" without unlocking into the app.

HOW IT GETS ITS DATA
--------------------
A widget is a separate process from the WebView and cannot read localStorage.
index.html mirrors a small JSON summary into Capacitor's Preferences plugin on
every save; that plugin writes to the "CapacitorStorage" SharedPreferences
file, which this widget reads back. If the key is missing (fresh install, or a
build without the plugin) the widget degrades to its quick-action buttons
rather than showing an error.

REFRESH BEHAVIOUR - KNOWN LIMIT
-------------------------------
Android caps updatePeriodMillis at 30 minutes, and pushing an update the moment
the app saves would need a custom Capacitor plugin to broadcast from JS. So the
widget refreshes on its 30-minute tick, whenever it is re-laid-out, and
immediately when its own refresh button is tapped. The refresh button is what
makes that limit liveable.

Safe to run more than once - every write is idempotent.
"""

import pathlib
import re
import sys

PKG = "com.plotedge.app"
JAVA_DIR = pathlib.Path("android/app/src/main/java/com/plotedge/app")
RES = pathlib.Path("android/app/src/main/res")
MANIFEST = pathlib.Path("android/app/src/main/AndroidManifest.xml")

WIDGET_JAVA = """package com.plotedge.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Home screen widget showing PlotEdge capture status.
 *
 * Reads the summary index.html mirrors into Capacitor's Preferences store (the
 * "CapacitorStorage" SharedPreferences file). Everything is defensive: a
 * missing key, malformed JSON, or a field of the wrong type all fall back to
 * the neutral "no project open" state rather than throwing, because an
 * exception here shows the user a permanently blank grey box that only a
 * re-add of the widget clears.
 */
public class PlotEdgeWidget extends AppWidgetProvider {

    private static final String PREFS = "CapacitorStorage";
    private static final String KEY = "plotedge_widget";
    public static final String ACTION_REFRESH = "com.plotedge.app.WIDGET_REFRESH";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, PlotEdgeWidget.class));
            onUpdate(ctx, mgr, ids);
        }
    }

    private void render(Context ctx, AppWidgetManager mgr, int widgetId) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.plotedge_widget);

        String project = null;
        int features = 0, inProgress = 0, unsynced = 0, projectCount = 0;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String raw = sp.getString(KEY, null);
            if (raw != null) {
                JSONObject o = new JSONObject(raw);
                project = o.isNull("project") ? null : o.optString("project", null);
                features = o.optInt("features", 0);
                inProgress = o.optInt("inProgress", 0);
                unsynced = o.optInt("unsynced", 0);
                projectCount = o.optInt("projects", 0);
            }
        } catch (Exception ignored) {
            // Fall through to the neutral state below.
        }

        if (project == null || project.length() == 0) {
            v.setTextViewText(R.id.widget_project,
                    projectCount > 0 ? "No project open" : "No projects yet");
            v.setTextViewText(R.id.widget_stats,
                    projectCount > 0 ? projectCount + " project" + (projectCount == 1 ? "" : "s") + " on device"
                                     : "Tap to create one");
        } else {
            v.setTextViewText(R.id.widget_project, project);
            StringBuilder s = new StringBuilder();
            s.append(features).append(features == 1 ? " feature" : " features");
            if (inProgress > 0) s.append("  ·  ").append(inProgress).append(" in progress");
            v.setTextViewText(R.id.widget_stats, s.toString());
        }

        // The unsynced line is the whole reason to glance at this widget, so it is only shown
        // when it actually says something - a permanent "0 unsynced" is noise.
        if (unsynced > 0) {
            v.setTextViewText(R.id.widget_warn,
                    unsynced + " project" + (unsynced == 1 ? "" : "s") + " not exported yet");
            v.setViewVisibility(R.id.widget_warn, android.view.View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.widget_warn, android.view.View.GONE);
        }

        v.setOnClickPendingIntent(R.id.widget_root, deepLink(ctx, "projects", 1));
        v.setOnClickPendingIntent(R.id.widget_capture, deepLink(ctx, "collect", 2));
        v.setOnClickPendingIntent(R.id.widget_map, deepLink(ctx, "review", 3));

        Intent refresh = new Intent(ctx, PlotEdgeWidget.class).setAction(ACTION_REFRESH);
        v.setOnClickPendingIntent(R.id.widget_refresh,
                PendingIntent.getBroadcast(ctx, 4, refresh, flags()));

        mgr.updateAppWidget(widgetId, v);
    }

    /**
     * plotedge://<target> is caught by MainActivity's intent-filter and surfaced to the web app
     * as Capacitor's appUrlOpen, which does the actual navigating. Keeping the routing in JS
     * means the widget does not need to know anything about the app's screen structure.
     */
    private PendingIntent deepLink(Context ctx, String target, int requestCode) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("plotedge://" + target));
        i.setPackage(ctx.getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode, i, flags());
    }

    /** FLAG_IMMUTABLE is mandatory from Android 12 (API 31); the constant exists from API 23. */
    private static int flags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    }
}
"""

WIDGET_LAYOUT = """<?xml version="1.0" encoding="utf-8"?>
<!-- Deliberately plain: widgets are re-inflated by the launcher process, which supports only a
     small subset of views, and any unsupported attribute silently yields a blank grey box. -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="14dp"
    android:background="@drawable/plotedge_widget_bg">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:gravity="center_vertical">

        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:text="PLOTEDGE"
            android:textColor="#7C8AA5"
            android:textSize="10sp"
            android:textStyle="bold"
            android:letterSpacing="0.12" />

        <TextView
            android:id="@+id/widget_refresh"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Refresh"
            android:textColor="#4F8EF7"
            android:textSize="11sp"
            android:textStyle="bold"
            android:padding="4dp" />
    </LinearLayout>

    <TextView
        android:id="@+id/widget_project"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="6dp"
        android:maxLines="1"
        android:ellipsize="end"
        android:text="No project open"
        android:textColor="#FFFFFF"
        android:textSize="16sp"
        android:textStyle="bold" />

    <TextView
        android:id="@+id/widget_stats"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="2dp"
        android:maxLines="1"
        android:ellipsize="end"
        android:text=""
        android:textColor="#A9B4C7"
        android:textSize="12sp" />

    <TextView
        android:id="@+id/widget_warn"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="4dp"
        android:maxLines="1"
        android:ellipsize="end"
        android:text=""
        android:textColor="#F5A524"
        android:textSize="11sp"
        android:textStyle="bold"
        android:visibility="gone" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="10dp"
        android:orientation="horizontal">

        <TextView
            android:id="@+id/widget_capture"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:layout_marginEnd="6dp"
            android:gravity="center"
            android:paddingTop="9dp"
            android:paddingBottom="9dp"
            android:text="Capture"
            android:textColor="#FFFFFF"
            android:textSize="12sp"
            android:textStyle="bold"
            android:background="@drawable/plotedge_widget_btn_primary" />

        <TextView
            android:id="@+id/widget_map"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:gravity="center"
            android:paddingTop="9dp"
            android:paddingBottom="9dp"
            android:text="Map"
            android:textColor="#DDE4EF"
            android:textSize="12sp"
            android:textStyle="bold"
            android:background="@drawable/plotedge_widget_btn" />
    </LinearLayout>
</LinearLayout>
"""

WIDGET_INFO = """<?xml version="1.0" encoding="utf-8"?>
<!-- minWidth/minHeight target a 4x2 cell footprint, the smallest size this much text fits in.
     updatePeriodMillis is 30 minutes because Android silently clamps anything lower; the in-widget
     Refresh button covers the gap between ticks.
     previewLayout is API 31+. Below that the picker falls back to previewImage, and a provider
     with NEITHER renders as a blank tile in the picker on older launchers - which reads as "the
     widget isn't there". The launcher icon is not a pretty preview, but it is recognisable and
     always present, so it is the right floor. -->
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="110dp"
    android:targetCellWidth="4"
    android:targetCellHeight="2"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/plotedge_widget"
    android:previewLayout="@layout/plotedge_widget"
    android:previewImage="@mipmap/ic_launcher"
    android:resizeMode="horizontal|vertical"
    android:widgetCategory="home_screen"
    android:description="@string/plotedge_widget_description" />
"""

WIDGET_BG = """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#141A26" />
    <corners android:radius="20dp" />
    <stroke android:width="1dp" android:color="#26314A" />
</shape>
"""

BTN_PRIMARY = """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#2E6BE6" />
    <corners android:radius="11dp" />
</shape>
"""

BTN_PLAIN = """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#1E2736" />
    <corners android:radius="11dp" />
    <stroke android:width="1dp" android:color="#2C3span" />
</shape>
""".replace("#2C3span", "#2C3750")

RECEIVER = """
    <!-- PlotEdge home screen widget (injected at build time) -->
    <!-- exported MUST be true. An AppWidgetProvider is a BroadcastReceiver that the *system*
         (AppWidgetService, a different process) delivers APPWIDGET_UPDATE to. With
         exported="false" that broadcast is refused, and - the symptom people actually notice -
         the launcher's widget picker does not list the widget at all, so there is no way to add
         it to a home screen. The only thing reachable through this receiver is a redraw of a
         status card the user already chose to place, so there is nothing here worth closing off. -->
    <receiver
        android:name=".PlotEdgeWidget"
        android:label="@string/plotedge_widget_label"
        android:exported="true">
        <intent-filter>
            <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            <action android:name="com.plotedge.app.WIDGET_REFRESH" />
        </intent-filter>
        <meta-data
            android:name="android.appwidget.provider"
            android:resource="@xml/plotedge_widget_info" />
    </receiver>
"""

DEEP_LINK_FILTER = """
            <!-- plotedge:// deep links from the home screen widget -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="plotedge" />
            </intent-filter>
"""


def write(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"  wrote {path}")


def main() -> int:
    if not MANIFEST.exists():
        print(f"ERROR: {MANIFEST} not found - run this after `npx cap add android`.")
        return 1

    write(JAVA_DIR / "PlotEdgeWidget.java", WIDGET_JAVA)
    write(RES / "layout" / "plotedge_widget.xml", WIDGET_LAYOUT)
    write(RES / "xml" / "plotedge_widget_info.xml", WIDGET_INFO)
    write(RES / "drawable" / "plotedge_widget_bg.xml", WIDGET_BG)
    write(RES / "drawable" / "plotedge_widget_btn_primary.xml", BTN_PRIMARY)
    write(RES / "drawable" / "plotedge_widget_btn.xml", BTN_PLAIN)

    # Description + label both live in strings.xml so the widget picker can show them.
    strings = RES / "values" / "strings.xml"
    if strings.exists():
        sx = strings.read_text(encoding="utf-8")
        added = []
        if "plotedge_widget_description" not in sx:
            sx = sx.replace(
                "</resources>",
                '    <string name="plotedge_widget_description">Capture status and quick actions</string>\n</resources>',
                1,
            )
            added.append("description")
        if "plotedge_widget_label" not in sx:
            sx = sx.replace(
                "</resources>",
                '    <string name="plotedge_widget_label">PlotEdge</string>\n</resources>',
                1,
            )
            added.append("label")
        if added:
            strings.write_text(sx, encoding="utf-8")
            print(f"  added widget {' + '.join(added)} to strings.xml")
        else:
            print("  already present: widget description + label strings")
    else:
        print("  WARN: strings.xml not found - widget picker will show no description")

    xml = MANIFEST.read_text(encoding="utf-8")
    changed = False

    if "PlotEdgeWidget" in xml:
        # Self-healing rather than a bare "already present". An android/ folder carried over from
        # an earlier build (or a local one that was never wiped) still holds the old
        # exported="false" receiver, and that is precisely the state where the widget silently
        # never appears in the picker - so re-running the patch has to be able to correct it.
        fixed = re.sub(
            r'(<receiver\s+android:name="\.PlotEdgeWidget"(?:\s+[^>]*?)?)\s+android:exported="false"',
            r'\1 android:exported="true"',
            xml,
        )
        if fixed != xml:
            xml = fixed
            changed = True
            print("  repairing: widget receiver was exported=false (widget would not appear in the picker)")
        else:
            print("  already present: widget receiver")
    else:
        if "</application>" not in xml:
            print("ERROR: no closing </application> tag - manifest looks malformed.")
            return 1
        xml = xml.replace("</application>", RECEIVER + "</application>", 1)
        changed = True
        print("  adding: widget receiver")

    if 'android:scheme="plotedge"' in xml:
        print("  already present: plotedge:// deep link filter")
    else:
        # Attach the filter to MainActivity's own <activity> block. Anchoring on the LAUNCHER
        # filter's closing tag is what keeps it inside the right activity rather than landing in
        # whatever element happens to close first.
        m = re.search(
            r"(<intent-filter>\s*<action android:name=\"android\.intent\.action\.MAIN\"\s*/>\s*"
            r"<category android:name=\"android\.intent\.category\.LAUNCHER\"\s*/>\s*</intent-filter>)",
            xml,
        )
        if m:
            xml = xml[: m.end(1)] + DEEP_LINK_FILTER + xml[m.end(1) :]
            changed = True
            print("  adding: plotedge:// deep link filter")
        else:
            print("  WARN: could not find the LAUNCHER intent-filter - deep links NOT added.")
            print("        The widget will still render; its buttons just won't route.")

    if changed:
        MANIFEST.write_text(xml, encoding="utf-8")
        print(f"Patched {MANIFEST}")
    else:
        print("Manifest already up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
