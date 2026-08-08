'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readIndex, ROOT } = require('./lib');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const html = readIndex();

// ══════════════════ NAVIGATION / BACK BUTTON ══════════════════
const BEGIN = '// ══ NAV:BEGIN ══', END = '// ══ NAV:END ══';
const i = html.indexOf(BEGIN), j = html.indexOf(END);
if (i === -1 || j === -1) {
  results.push({ name: 'nav block is extractable for testing', ok: false, msg: 'NAV:BEGIN/NAV:END sentinels not found' });
} else {
  results.push({ name: 'nav block is extractable for testing', ok: true });
  const src = html.slice(i, j);

  // Minimal history stack that behaves like the browser's for our purposes.
  function boot() {
    const stack = [{ screen: 'projects' }];
    let idx = 0;
    const ctx = {
      console, JSON, Object, Math, Date,
      history: {
        get state() { return stack[idx]; },
        get length() { return idx + 1; },
        pushState(s) { stack.length = idx + 1; stack.push(s); idx++; },
        replaceState(s) { stack[idx] = s; },
        back() { if (idx > 0) { idx--; ctx._onpop(stack[idx]); } }
      },
      _stack: stack,
      _idx: () => idx,
      showToast: () => {},
      _onpop: () => {},
      activeProjectId: 'p1',
      projects: [{ id: 'p1' }],
      currentTab: null,
      // Mirrors what the real switchTab() does, so the "already on this tab"
      // check is exercised rather than being masked by the push dedupe.
      switchTab(n) { ctx.currentTab = n; ctx.noteCurrentTab(n); },
      openProject() {},
      showProjects() {},
      suppressNavPush: false
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'nav-block' });
    return ctx;
  }

  check('re-tapping the tab you are already on does not stack a history stop', () => {
    const ctx = boot();
    ctx.switchTabNav('collect');
    const depth = ctx._idx();
    ctx.switchTabNav('collect');
    ctx.switchTabNav('collect');
    assert(ctx._idx() === depth,
      `three taps on Collect left ${ctx._idx() - depth + 1} stops — Back would need that many presses to move one screen`);
  });

  check('one Back press moves one screen after a realistic tab tour', () => {
    const ctx = boot();
    ctx.switchTabNav('collect');
    ctx.switchTabNav('collect');   // stray double-tap, very easy on a field device
    ctx.switchTabNav('review');
    ctx.switchTabNav('review');
    let landed = null;
    ctx._onpop = st => { landed = st; };
    ctx.history.back();
    assert(landed && landed.tab === 'collect', `first Back landed on ${landed && landed.tab} — expected collect`);
    ctx.history.back();
    assert(landed && landed.screen === 'projects', `second Back landed on ${JSON.stringify(landed)} — expected the projects root`);
  });

  check('pushNavState refuses to duplicate the state already on top', () => {
    const ctx = boot();
    ctx.pushNavState('app', { projectId: 'p1', tab: 'export' });
    const d = ctx._idx();
    ctx.pushNavState('app', { projectId: 'p1', tab: 'export' });
    assert(ctx._idx() === d, 'an identical consecutive history stop was pushed');
  });

  check('a real screen change still pushes', () => {
    const ctx = boot();
    const d = ctx._idx();
    ctx.pushNavState('app', { projectId: 'p1', tab: 'import' });
    assert(ctx._idx() === d + 1, 'a genuine navigation was swallowed by the dedupe');
  });

  check('the same-tab check works even when the stop differs (KPI card re-entry)', () => {
    // A dashboard KPI card calls switchTabNav('review') then changes the view
    // mode. Tapping two different cards that both land on Review must not leave
    // two stops behind, even though the push-dedupe alone would not catch a
    // caller that varied the extra fields.
    const ctx = boot();
    ctx.switchTabNav('review');
    const depth = ctx._idx();
    ctx.switchTabNav('review');
    assert(ctx.getCurrentTab() === 'review', 'current tab was not tracked');
    assert(ctx._idx() === depth, 'a second stop was recorded for a tab already open');
  });

  check('the landing screen is reachable once projects exist', () => {
    // renderProjectsScreen() routes past #view-projects to the Project Manager the moment one
    // project exists, so the home screen — and the three primary actions on it — became
    // unreachable after first use. showLanding() forces it regardless of count.
    assert(/function showLanding\(\)/.test(html), 'no showLanding() route');
    assert(/function renderLandingScreen\(\)[\s\S]{0,400}activateView\('view-projects'\)/.test(html),
      'renderLandingScreen does not force the landing view');
    const entries = (html.match(/onclick="showLanding\(\)"/g) || []).length;
    assert(entries >= 3, `only ${entries} way(s) into the landing screen — expected the app header, Data hub and Project Manager`);
  });

  check('Back replays the landing stop instead of falling through', () => {
    assert(/st\.screen === 'landing'[\s\S]{0,120}renderLandingScreen\(\)/.test(html),
      'popstate has no handler for the landing stop, so Back would skip past it');
    assert(/pushNavState\('landing'\)/.test(html), 'showLanding does not record a history stop');
  });

  check('the landing texture is scoped to the landing screen only', () => {
    assert(/#view-projects::before/.test(html), 'no landing texture');
    assert(/--contour-tile:\s*url\("data:image\/svg\+xml/.test(html), 'contour tile is not inlined');
    // It must not leak onto any other view, and must never eat a tap.
    const rule = html.slice(html.indexOf('#view-projects::before'), html.indexOf('#view-projects::before') + 600);
    assert(/pointer-events:\s*none/.test(rule), 'the texture can intercept taps');
    assert(/mask-image/.test(rule), 'the texture is not masked, so it cannot follow the accent');
    assert(/html\[data-contrast="high"\] #view-projects::before \{ display: none/.test(html),
      'the texture survives outdoor high-contrast mode, where all decoration should be stripped');
  });

  check('back arrow and hardware Back run the same code path', () => {
    assert(/function headerBackTap[\s\S]{0,600}appBack\(\)/.test(html) || /headerBackTap\s*=\s*appBack/.test(html),
      'the header arrow does not delegate to the shared back handler');
    assert(/addListener\('backButton'[\s\S]{0,400}appBack\(\)/.test(html),
      'the Android hardware button does not delegate to the shared back handler');
  });

  check('an invisible overlay cannot swallow a Back press', () => {
    // .show on an element that is display:none / not connected used to make
    // closeTopOverlay() return true and eat the press with nothing visible.
    assert(/function isReallyOpen|offsetParent|checkVisibility/.test(html),
      'closeTopOverlay() trusts the .show class alone, with no visibility check');
  });
}

// ══════════════════ ANDROID PACKAGING ══════════════════
// The workflow is created on GitHub rather than shipped in the archive (macOS
// hides dot-paths and Archive Utility drops them), so a fresh local checkout may
// not have it yet. These checks then skip rather than fail — they still run in
// CI, which is the only place the workflow actually matters.
const WF_PATH = path.join(ROOT, '.github/workflows/build-apk.yml');
const haveWf = fs.existsSync(WF_PATH);
const wf = haveWf ? fs.readFileSync(WF_PATH, 'utf8') : '';
function checkCI(name, fn) {
  if (!haveWf) { results.push({ name, ok: true, skipped: true }); return; }
  check(name, fn);
}

checkCI('APK is signed with a stable key across builds', () => {
  // Without this every CI run generates a fresh ~/.android/debug.keystore, so
  // each APK has a different signature. Android then refuses an in-place update
  // and the only way in is uninstall+reinstall, which deletes app data.
  assert(/patch-android-signing\.py/.test(wf), 'workflow never runs the signing patch');
  assert(/ANDROID_KEYSTORE_B64|plotedge-release\.keystore|plotedge\.jks/.test(wf), 'workflow has no persistent keystore source');
  assert(fs.existsSync(path.join(ROOT, 'scripts/patch-android-signing.py')), 'scripts/patch-android-signing.py missing');
});

check('signing patch applies the stable key to the build type that is shipped', () => {
  const s = fs.readFileSync(path.join(ROOT, 'scripts/patch-android-signing.py'), 'utf8');
  assert(/signingConfigs/.test(s), 'no signingConfigs block injected');
  assert(/debug\s*\{[\s\S]{0,400}signingConfig/.test(s) || /buildTypes[\s\S]{0,800}signingConfig/.test(s),
    'the shipped build type does not reference the stable signing config');
});

checkCI('versionCode increments per build so Android sees a real update', () => {
  const s = fs.readFileSync(path.join(ROOT, 'scripts/patch-android-signing.py'), 'utf8');
  assert(/versionCode/.test(s), 'versionCode is never rewritten — every build stays at 1');
  assert(/run_number|GITHUB_RUN_NUMBER|PLOTEDGE_VERSION_CODE/.test(wf + s), 'versionCode is not derived from the build number');
});

check('app data is included in Android auto-backup', () => {
  const s = fs.readFileSync(path.join(ROOT, 'scripts/patch-android-manifest.py'), 'utf8');
  assert(/allowBackup/.test(s), 'android:allowBackup is never set, so device transfer/restore skips the survey data');
});

checkCI('the build fails loudly rather than shipping an unsignable APK', () => {
  assert(/exit 1|::error|set -e/.test(wf), 'no failure path if the keystore cannot be resolved');
});

module.exports = results;
if (require.main === module) {
  let bad = 0;
  for (const r of results) {
    console.log(`${r.skipped ? '  SKIP' : r.ok ? '  PASS' : '  FAIL'}  ${r.name}${r.ok ? '' : '\n        ' + r.msg}`);
    if (!r.ok) bad++;
  }
  console.log(`\n  nav+build: ${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
}
