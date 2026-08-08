#!/usr/bin/env python3
"""
Give every build the SAME signing identity and an INCREASING versionCode.

═══════════════════════════════════════════════════════════════════════════════
WHY THIS EXISTS — this is the "I have to cancel the first install, then go for
update the second time" bug, and it is also what wiped the survey data.

`android/` is not committed; `npx cap add android` regenerates it on every run,
and `./gradlew assembleDebug` signs with Gradle's *auto-generated* debug key at
~/.android/debug.keystore. A GitHub Actions runner is a fresh VM, so that file
never exists and Gradle quietly creates a BRAND NEW RANDOM KEY on every single
build. Every APK therefore carries a different signature.

Android will not update an installed app whose signature does not match the
incoming one (INSTALL_FAILED_UPDATE_INCOMPATIBLE). The package installer's only
route forward is uninstall-then-install — which is exactly the cancel/retry
dance, and which deletes /data/data/com.plotedge.app. The WebView's localStorage
lives in there. That is where the projects, the feature types and every app
setting went: not a crash inside the app, but the installer removing the app
directory because the new APK could not be recognised as the same app.

On top of that, `cap add android` always writes versionCode 1, so even with
matching signatures Android sees every build as a same-version reinstall.

This script fixes both: a persistent keystore (checked in under signing/, or
supplied via the ANDROID_KEYSTORE_B64 secret) applied to the build type that is
actually shipped, and a versionCode derived from the CI run number.

Safe to run more than once; it is a no-op if already applied.
═══════════════════════════════════════════════════════════════════════════════
"""

import os
import pathlib
import re
import sys

GRADLE = pathlib.Path("android/app/build.gradle")
MARKER = "// PLOTEDGE-SIGNING"


def resolve_keystore() -> pathlib.Path:
    """The keystore the APK will be signed with, in priority order."""
    # 1. CI secret, already decoded to this path by the workflow.
    env = os.environ.get("PLOTEDGE_KEYSTORE_PATH", "").strip()
    if env and pathlib.Path(env).exists():
        return pathlib.Path(env).resolve()
    # 2. The copy committed to the repo. A self-signed sideload key, not a Play
    #    Store upload key — its only job is to stay byte-identical between
    #    builds so Android keeps recognising the app as the same app.
    local = pathlib.Path("signing/plotedge-release.keystore")
    if local.exists():
        return local.resolve()
    return None


def version_code() -> int:
    """
    Monotonic across builds. GITHUB_RUN_NUMBER only ever counts up for a given
    workflow, which is exactly Android's requirement for an in-place update.
    """
    for var in ("PLOTEDGE_VERSION_CODE", "GITHUB_RUN_NUMBER"):
        raw = os.environ.get(var, "").strip()
        if raw.isdigit() and int(raw) > 0:
            return int(raw)
    return 1


def version_name(code: int) -> str:
    return os.environ.get("PLOTEDGE_VERSION_NAME", "").strip() or f"1.0.{code}"


def patch_gradle(keystore: pathlib.Path, code: int, name: str) -> int:
    if not GRADLE.exists():
        print(f"ERROR: {GRADLE} not found — run this after `npx cap add android`.")
        return 1

    text = GRADLE.read_text(encoding="utf-8")
    if MARKER in text:
        print("  already patched; skipping")
        return 0

    store_pass = os.environ.get("PLOTEDGE_KEYSTORE_PASSWORD", "plotedge")
    key_alias = os.environ.get("PLOTEDGE_KEY_ALIAS", "plotedge")
    key_pass = os.environ.get("PLOTEDGE_KEY_PASSWORD", store_pass)

    # ── versionCode / versionName ──
    # These live in defaultConfig. Rewriting rather than appending, because
    # Gradle takes the last assignment and a stale `versionCode 1` sitting above
    # ours would be harmless but confusing to read back.
    before = text
    text = re.sub(r"versionCode\s+\d+", f"versionCode {code}", text, count=1)
    text = re.sub(r'versionName\s+"[^"]*"', f'versionName "{name}"', text, count=1)
    if text == before:
        print("  WARNING: versionCode/versionName not found in defaultConfig")

    signing_block = f"""
    {MARKER} — stable identity so Android accepts an in-place update.
    signingConfigs {{
        plotedge {{
            storeFile file('{keystore.as_posix()}')
            storePassword '{store_pass}'
            keyAlias '{key_alias}'
            keyPassword '{key_pass}'
        }}
    }}
"""

    # Insert signingConfigs immediately inside `android {`.
    m = re.search(r"^android\s*\{", text, flags=re.MULTILINE)
    if not m:
        print("ERROR: no `android {` block in build.gradle")
        return 1
    text = text[: m.end()] + signing_block + text[m.end():]

    # ── apply it to the build type that actually ships ──
    # The workflow publishes assembleDebug, so the debug build type is the one
    # that must carry the stable key. Release is set too, so switching the
    # workflow to assembleRelease later needs no second change here.
    def attach(block_name: str, body: str) -> str:
        pattern = re.compile(r"(buildTypes\s*\{)", re.MULTILINE)
        if not pattern.search(body):
            # No buildTypes block at all — add one.
            m2 = re.search(r"^android\s*\{", body, flags=re.MULTILINE)
            body = body[: m2.end()] + "\n    buildTypes {\n    }\n" + body[m2.end():]
        # Does the named build type already exist inside buildTypes?
        bt = re.search(r"buildTypes\s*\{", body)
        idx = bt.end()
        existing = re.compile(r"\b" + block_name + r"\s*\{")
        tail = body[idx:]
        em = existing.search(tail)
        if em:
            insert_at = idx + em.end()
            return (
                body[:insert_at]
                + f"\n            signingConfig signingConfigs.plotedge {MARKER}"
                + body[insert_at:]
            )
        return (
            body[:idx]
            + f"\n        {block_name} {{\n            signingConfig signingConfigs.plotedge {MARKER}\n        }}"
            + body[idx:]
        )

    text = attach("debug", text)
    text = attach("release", text)

    GRADLE.write_text(text, encoding="utf-8")
    print(f"  signed with: {keystore}")
    print(f"  versionCode: {code}   versionName: {name}")
    return 0


def main() -> int:
    keystore = resolve_keystore()
    if keystore is None:
        print(
            "ERROR: no keystore found.\n"
            "  Expected signing/plotedge-release.keystore in the repo, or the\n"
            "  ANDROID_KEYSTORE_B64 secret decoded to PLOTEDGE_KEYSTORE_PATH.\n"
            "  Refusing to build: an APK signed with a throwaway debug key cannot\n"
            "  update the installed app and forces an uninstall, which deletes all\n"
            "  captured survey data."
        )
        return 1
    code = version_code()
    return patch_gradle(keystore, code, version_name(code))


if __name__ == "__main__":
    sys.exit(main())
