#!/usr/bin/env python3
"""
Inject the runtime permissions PlotEdge needs into the AndroidManifest.xml that
`npx cap add android` generates.

The default Capacitor manifest only declares INTERNET. Android will not show a
permission toggle in Settings -> Apps -> PlotEdge -> Permissions for anything
that is not declared here, and requestPermissions() for an undeclared
permission is auto-denied without ever showing a prompt. That is why GPS and
camera silently fail in the APK while working fine in the browser.

Safe to run more than once - it skips anything already present.
"""

import pathlib
import sys

MANIFEST = pathlib.Path("android/app/src/main/AndroidManifest.xml")

PERMISSIONS = [
    # navigator.geolocation (WebView geolocation prompt -> Capacitor asks for these two)
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    # getUserMedia({video}) for the barcode scanner, and <input capture="environment">
    "android.permission.CAMERA",
    # getUserMedia({audio}) for voice notes
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
]

# required="false" so the Play Store / sideload never filters the app off a
# device that happens to be missing the hardware.
FEATURES = [
    "android.hardware.camera",
    "android.hardware.location.gps",
]


def patch_backup_attrs(xml: str) -> str:
    """
    Force android:allowBackup="true" (and the Android 12+ equivalent) on the
    <application> tag. Set explicitly rather than relying on the platform
    default, because the default flipped between target SDK levels and the
    generated manifest does not pin it either way.
    """
    import re as _re

    m = _re.search(r"<application\b[^>]*>", xml)
    if not m:
        print("  WARNING: no <application> tag; skipping backup attributes")
        return xml
    tag = m.group(0)
    new_tag = tag
    for attr, value in (
        ("android:allowBackup", "true"),
        ("android:fullBackupOnly", "true"),
    ):
        if attr in new_tag:
            new_tag = _re.sub(
                rf'{attr}="[^"]*"', f'{attr}="{value}"', new_tag
            )
            print(f"  updating: {attr}=\"{value}\"")
        else:
            new_tag = new_tag[:-1].rstrip() + f' {attr}="{value}">'
            print(f"  adding: {attr}=\"{value}\"")
    return xml.replace(tag, new_tag, 1)


def main() -> int:
    if not MANIFEST.exists():
        print(f"ERROR: {MANIFEST} not found - run this after `npx cap add android`.")
        return 1

    xml = MANIFEST.read_text(encoding="utf-8")

    additions = []
    for perm in PERMISSIONS:
        if perm in xml:
            print(f"  already present: {perm}")
            continue
        additions.append(f'    <uses-permission android:name="{perm}" />')
        print(f"  adding: {perm}")

    for feat in FEATURES:
        if feat in xml:
            print(f"  already present: {feat}")
            continue
        additions.append(
            f'    <uses-feature android:name="{feat}" android:required="false" />'
        )
        print(f"  adding: {feat} (required=false)")

    # ══ AUTO-BACKUP ══
    # All captured data lives in the WebView's localStorage, i.e. inside the app
    # data directory. Android's Auto Backup / device-transfer will carry that
    # directory to a new phone or restore it after a factory reset, but ONLY if
    # allowBackup is on. Capacitor's generated manifest leaves it unset, so a
    # crew changing devices silently starts from nothing. This is a second line
    # of defence behind the in-app backup file, not a replacement for it — a
    # sideloaded APK is not restored by Play, so the export is still the copy
    # that matters most.
    xml = patch_backup_attrs(xml)

    if not additions:
        print("Backup attributes checked; nothing else to do.")
        MANIFEST.write_text(xml, encoding="utf-8")
        return 0

    if "</manifest>" not in xml:
        print("ERROR: no closing </manifest> tag - manifest looks malformed.")
        return 1

    block = "\n    <!-- PlotEdge hardware permissions (injected at build time) -->\n"
    block += "\n".join(additions) + "\n"

    xml = xml.replace("</manifest>", block + "</manifest>", 1)
    MANIFEST.write_text(xml, encoding="utf-8")
    print(f"Patched {MANIFEST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
