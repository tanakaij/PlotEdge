// ═══════════════════════════════════════════════════════════════════════════
// PlotEdge — Theme, domain palette, screen bands, units, contrast, density, settings modal
// ═══════════════════════════════════════════════════════════════════════════
// Part of an ordered set: js/*.js are plain classic scripts loaded in filename
// order by index.html. Order matters — a file can only use top-level names
// declared in itself or in a file loaded before it. Renumbering or reordering
// them will break the app; `npm test` checks this.

// ══ THEME (light/dark) ══
// ══ THEME (auto / light / dark) ══
// The initial theme is already applied by the tiny blocking script in <head> (avoids a flash of
// the wrong theme). This block owns the toggle button + Settings seg-control, persistence, and
// OS-preference syncing for the rest of the session. 'auto' is not just the default — it stays
// live for as long as the person leaves it on Auto, so the app keeps following the device's
// light/dark switch (e.g. sunrise/sunset auto-switching on iOS) rather than only reading it once
// at first launch. Picking Light or Dark explicitly stops that syncing until switched back.
const THEME_KEY = 'plotedge_theme';

// ══ DOMAIN THEME + SCREEN STATE ══
// Two axes, both stored on <html> so a single CSS selector can express any combination:
//   data-theme  light/dark   (existing)
//   data-domain the GIS palette
//   data-screen the ambient intensity band
const DOMAIN_KEY = 'plotedge_domain';

// The six pillars. Order here drives the settings picker, and is arranged so
// adjacent swatches are never adjacent hues — two greens or two blues side by
// side is what made the old picker hard to read.
const GIS_DOMAINS = {
  land:        { label:'Earth & Land',     hint:'Soils, terrain, land use' },
  water:       { label:'Water',            hint:'Hydrology, drainage, WASH' },
  climate:     { label:'Climate',          hint:'Weather, hazard, risk' },
  environment: { label:'Environment',      hint:'Forestry, conservation, biodiversity' },
  people:      { label:'People & Places',  hint:'Settlements, households, social survey' },
  geospatial:  { label:'Geospatial',       hint:'Cadastral, control, instrument work' }
};

// ══ LEGACY MIGRATION ══
// Devices already in the field have one of the old five keys in localStorage.
// Without this table setDomainTheme() would fall through to its default and
// silently reset a crew's chosen palette on the first launch after updating.
// Mapped by meaning, not by colour: Agriculture was the soils/land pillar, so
// it becomes Earth & Land rather than Environment.
const DOMAIN_ALIASES = {
  default:  'water',        // was "Hydrology & Field"
  forestry: 'environment',  // was "Canopy & Conservation"
  agric:    'land',         // was "Precision Ag & Soils"
  survey:   'geospatial',   // was "Cadastral & Parcels"
  climate:  'climate'       // unchanged in name; re-tinted violet
};

// Single resolver used by both the pre-paint boot script and setDomainTheme(),
// so a stored value can never be interpreted two different ways.
function resolveDomain(name){
  if (GIS_DOMAINS[name]) return name;
  if (DOMAIN_ALIASES[name]) return DOMAIN_ALIASES[name];
  return 'geospatial';
}

function currentDomain(){ return document.documentElement.getAttribute('data-domain') || 'geospatial'; }

function setDomainTheme(name, announce){
  name = resolveDomain(name);
  // Reuses the theme-switching freeze: without it every accent-coloured control animates its own
  // transition independently and the swap arrives as a ragged wash instead of a clean cut.
  const root = document.documentElement;
  root.classList.add('theme-switching');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  root.setAttribute('data-domain', name);
  try { localStorage.setItem(DOMAIN_KEY, name); } catch(e) {}
  // ══ MAKE THE CHANGE VISIBLE ══
  // A toast alone was not enough: on a scrolled list, or on Review where the
  // ambient layer is deliberately at zero over the map tiles, the switch could
  // land with no perceptible result. This washes the NEW accent across the
  // screen once and fades. It is its own fixed overlay rather than an animation
  // on .mesh-blobs, for two reasons: the mesh is suppressed on exactly the
  // screens that need the confirmation most, and an animation ending on the
  // mesh would have to land on whatever opacity the current screen band sets,
  // snapping when it finished.
  const bloom = document.getElementById('domainBloom');
  if (bloom) {
    bloom.classList.remove('play');
    void bloom.offsetWidth;            // force a reflow so the class re-triggers
    bloom.classList.add('play');
    bloom.addEventListener('animationend', () => bloom.classList.remove('play'), { once:true });
  }
  // The status bar and PWA chrome read a resolved colour, not a token, so they have to be told
  // again after the palette changes.
  requestAnimationFrame(()=>{
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', cssVar('--grad-1') || '#0B0F19');
  });
  syncDomainPickerUI();
  if (announce) showToast('Theme: ' + GIS_DOMAINS[name].label);
}

// Screen context drives how loud the ambient mesh is allowed to be. Called from the navigation
// entry points rather than inferred from a scroll position or a route string, so a screen that
// needs a specific band (Map, above all) can never end up with the wrong one.
const SCREEN_STATES = ['home','form','map','settings'];

function setScreenState(name){
  if (SCREEN_STATES.indexOf(name) === -1) name = 'home';
  document.documentElement.setAttribute('data-screen', name);
}

function currentScreenState(){ return document.documentElement.getAttribute('data-screen') || 'home'; }

function syncDomainPickerUI(){
  const active = currentDomain();
  document.querySelectorAll('.domain-swatch').forEach(el => {
    const on = el.dataset.domain === active;
    el.classList.toggle('sel', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function currentTheme(){ return document.documentElement.getAttribute('data-theme') || 'dark'; }

function currentThemeMode(){ return document.documentElement.getAttribute('data-theme-mode') || 'auto'; }

function systemPrefersLight(){ return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches); }

function applyTheme(theme){
  // ══ GLITCH-FREE SWITCH ══
  // Many components carry transitions on background/border/color (buttons, chips, inputs, the
  // step badges). Flipping the theme attribute makes every one of those animate independently,
  // so the repaint arrives as a ragged several-hundred-ms wash rather than a clean cut. Killing
  // transitions for exactly one frame makes the swap atomic. The double rAF matters: the first
  // frame is where the new colours are painted, so the class can only be lifted on the second —
  // removing it after a single frame reintroduces the fade it was meant to suppress.
  const root = document.documentElement;
  root.classList.add('theme-switching');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  document.documentElement.setAttribute('data-theme', theme);
  // Keep the browser/PWA chrome (status bar, task switcher) in sync with the active theme — read
  // the *actual* --grad-1 token rather than a hardcoded hex, so the status bar is always the exact
  // same shade as the header sitting right below it (edge-to-edge, no visible seam), including in
  // outdoor/high-contrast mode where surfaces shift slightly.
  requestAnimationFrame(()=>{
    const metaTheme=document.querySelector('meta[name="theme-color"]');
    if(metaTheme) metaTheme.setAttribute('content', cssVar('--grad-1') || (theme==='light' ? '#FFFFFF' : '#0B0F19'));
  });
  // The status bar is transparent and draws over the app's own gradient (edge-to-edge), so the
  // ANDROID APK build needs its icon color (clock/battery/notch) flipped to match — dark icons
  // over the light/pink theme's header, light icons over the dark theme's. AndroidChrome is
  // injected by MainActivity (see scripts/patch-android-ui.py) and is only present in the APK
  // build, not in the plain browser/PWA, so this is a no-op there.
  if (window.AndroidChrome && typeof window.AndroidChrome.setLightStatusBar === 'function') {
    try { window.AndroidChrome.setLightStatusBar(theme === 'light'); } catch(e) {}
  }
  const mode = currentThemeMode();
  const nextLabel = mode==='auto' ? 'light' : mode==='light' ? 'dark' : 'auto';
  document.querySelectorAll('.theme-toggle').forEach(btn=>{
    btn.innerHTML = mode==='auto' ? AUTO_ICON : (theme==='light' ? SUN_ICON : MOON_ICON);
    btn.setAttribute('title', mode==='auto' ? `Auto theme (currently ${theme}) · tap for ${nextLabel}` : `${theme[0].toUpperCase()}${theme.slice(1)} theme · tap for ${nextLabel}`);
  });
  syncSettingsModalUI();
}

// mode: 'auto' | 'light' | 'dark'. Replaces the old binary setTheme(); kept as the single place
// that resolves a mode down to an actual rendered theme and persists the *mode* (not the
// resolved theme), since 'auto' has to be stored as itself to keep following the OS afterward.
function setThemeMode(mode){
  document.documentElement.setAttribute('data-theme-mode', mode);
  applyTheme(mode==='auto' ? (systemPrefersLight() ? 'light' : 'dark') : mode);
  try{ localStorage.setItem(THEME_KEY, mode); }catch(e){}
}

// toggleTheme() removed: the Settings modal shows Auto/Light/Dark as a segmented control and
// calls setThemeMode() with an explicit value, so nothing cycled through them any more.
const MOON_ICON='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

const SUN_ICON='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

// Distinct from both — a small monitor/device glyph, so "Auto" reads as "following the system"
// rather than looking like a third light/dark variant.
const AUTO_ICON='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';

// Sync automatically with OS-level changes for as long as the mode is 'auto'.
if(window.matchMedia){
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e=>{
    if (currentThemeMode() === 'auto') applyTheme(e.matches ? 'light' : 'dark');
  });
}

// applyTheme(currentTheme()) used to run HERE. It moved to js/22-boot.js.
//
// WHY: it paints the toggle icons, which means it calls syncSettingsModalUI(),
// which calls syncPlotLensEntry() (js/15) and renderQuickActions() (js/16).
// In the old single file every function declaration hoisted to the top of one
// script, so a load-time call could reach a function defined 10,000 lines below
// it. Split across files that is no longer true: js/01 runs before js/15 exists,
// and this threw ReferenceError on every launch — taking the rest of js/01 with
// it, which is how one stray call becomes a blank app.
// The visible theme is already correct before this runs: the pre-paint script in
// index.html sets data-theme on <html>. This call only syncs the toggle icons,
// so running it at the end of boot costs nothing.


// ══ KEYBOARD-AWARE VIEWPORT ══
// Two separate mobile-keyboard problems, one script:
// 1) Fixed-position bottom sheets (.modal-overlay/.modal-box — coordinate entry, settings, etc.)
//    are sized against the *layout* viewport, which iOS Safari does NOT shrink when the keyboard
//    opens. That leaves the sheet's own action buttons positioned behind the keyboard, invisible,
//    even though the sheet itself looks fine. --vvh (set from window.visualViewport, which DOES
//    shrink) lets the CSS constrain the sheet to only the actually-visible area above the keyboard.
// 2) Inputs living in normal page flow (New Project, Feature Type editor, attribute fields, etc.)
//    can still end up covered right as the keyboard finishes animating in, especially the button
//    sitting just below the last field in a form — the browser's own "scroll focused input into
//    view" doesn't always leave room for what's below it. A short delay + explicit scrollIntoView
//    on focus (timed to land after the keyboard's opening animation, not before) fixes that for
//    both platforms without depending on browser-specific auto-scroll behavior.
// PERF: this used to write --vvh straight onto documentElement on every event, with a
// visualViewport 'scroll' listener attached. visualViewport scroll fires continuously while
// a finger is on the screen, and --vvh is a custom property on the root — so every single
// scroll frame invalidated style for the entire document tree. That was the single largest
// source of the app feeling sticky/jerky while scrolling long vertex lists.
//
// Two changes: coalesce writes into one rAF (so at most one per frame no matter how many
// events land), and skip the write entirely when the height hasn't actually changed — which
// is the case for essentially every scroll event, since only the keyboard and the URL bar
// really move it. Steady-state cost is now zero style invalidations instead of ~60/second.
//
// --vvh alone was not enough. It tells you how tall the visible strip is, but not *where* it
// starts, and not how much of the screen the keyboard is eating — both of which the overlay
// rules now need (see the .modal-overlay comment in the stylesheet). Three values, one pass:
//   --vvh  visible viewport height          (unchanged, kept for anything still reading it)
//   --kbh  keyboard height, bottom-anchored (innerHeight − visible height − top offset)
//   --vvot how far the visual viewport has been scrolled below the layout viewport
// --vvot is only written while the keyboard is actually up. Outside that it is pinned to 0,
// which keeps the steady-state write count at zero during ordinary scrolling — the whole point
// of the rAF coalescing below — since offsetTop otherwise ticks on every rubber-band frame.
let vvhPending = false, vvhLast = -1, kbhLast = -1, vvotLast = -1;

const KB_OPEN_PX = 90; // below this it's browser chrome moving, not a keyboard

function applyVvh(){
  vvhPending = false;
  const vv = window.visualViewport;
  const h = Math.round((vv && vv.height) || window.innerHeight);
  const offTop = Math.round((vv && vv.offsetTop) || 0);
  let kbh = Math.max(0, Math.round(window.innerHeight - h - offTop));
  if (kbh < KB_OPEN_PX) kbh = 0;
  const vvot = kbh > 0 ? offTop : 0;
  const root = document.documentElement;
  if (h !== vvhLast)      { vvhLast = h;      root.style.setProperty('--vvh', h + 'px'); }
  if (kbh !== kbhLast) {
    const wasClosed = kbhLast <= 0;
    kbhLast = kbh;
    root.style.setProperty('--kbh', kbh + 'px');
    root.classList.toggle('kb-open', kbh > 0);
    // The sheet has just been resized under a field that was already focused. The browser's own
    // "scroll focused element into view" ran against the pre-keyboard layout, so re-run it now
    // that the sheet knows its real height — this is what stops a tapped field from sitting
    // half-under the keyboard on the first tap and only correcting on the second.
    if (kbh > 0 && wasClosed) requestAnimationFrame(scrollFocusedIntoView);
  }
  if (vvot !== vvotLast)  { vvotLast = vvot;  root.style.setProperty('--vvot', vvot + 'px'); }
}

function scrollFocusedIntoView(){
  const el = document.activeElement;
  if (!el || !el.matches || !el.matches('input, textarea, select')) return;
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) { el.scrollIntoView(false); }
  if (typeof refreshOpenSheetScrollFlags === 'function') refreshOpenSheetScrollFlags();
}

function setVvh(){
  if (vvhPending) return;
  vvhPending = true;
  requestAnimationFrame(applyVvh);
}

applyVvh();

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setVvh, { passive: true });
  window.visualViewport.addEventListener('scroll', setVvh, { passive: true });
} else {
  window.addEventListener('resize', setVvh, { passive: true });
}

document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el.matches || !el.matches('input, textarea, select')) return;
  // Delay lets the on-screen keyboard finish opening first — scrolling immediately on focus means
  // the browser measures "visible area" before the keyboard has actually taken up its space, so
  // the button just past the field can still end up hidden underneath it.
  setTimeout(() => {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 300);
}, true);


// Chrome/Safari change a number input's value when the mouse wheel passes over it *while it's
// focused* — nothing to do with the (now-hidden) stepper arrows, it fires even without them. On
// the Collect page's attribute fields this reads as the page "glitching" mid-scroll: a value
// silently ticks up/down as the wheel scrolls past it. Blurring the field the instant a wheel
// event starts means the scroll just scrolls the page like normal, and the field keeps whatever
// value was last typed.
document.addEventListener('wheel', (e) => {
  const el = document.activeElement;
  if (el && el.tagName === 'INPUT' && el.type === 'number') el.blur();
}, { passive: true });


// ══ UNITS (metric / imperial display) ══
// Everything is captured and stored in metric/SI (meters, square meters) — that never changes,
// so exports stay consistent regardless of this setting. This only controls how distances/areas
// are *displayed* on screen (accuracy, altitude, and the auto-computed line/polygon geometry).
const UNITS_KEY = 'plotedge_units';

function currentUnits(){ try{ return localStorage.getItem(UNITS_KEY) || 'metric'; }catch(e){ return 'metric'; } }

function setUnits(next, announce){
  try{ localStorage.setItem(UNITS_KEY, next); }catch(e){}
  document.querySelectorAll('.units-toggle').forEach(btn=>{ btn.textContent = next==='metric' ? 'm' : 'ft'; });
  if (announce) showToast(next==='metric' ? 'Units: metric (m)' : 'Units: imperial (ft)');
  // Refresh anything currently on screen that shows a length/area/altitude so the change is
  // immediately visible without needing a new GPS fix or re-opening the feature.
  if (typeof renderVertexEditor==='function') renderVertexEditor();
  if (typeof renderPoints==='function') renderPoints();
  if (typeof renderFeatures==='function') renderFeatures();
  syncSettingsModalUI();
}

// toggleUnits() removed — superseded by setUnits() called with an explicit value from Settings.
// Settings-modal entry point — sets an explicit value rather than toggling, since the modal shows
// both options at once (a segmented control) rather than one button that flips state on tap.
function setUnitsPref(mode){ setUnits(mode, true); }

function formatLength(m){
  if (m==null || isNaN(m)) return '—';
  return currentUnits()==='metric' ? `${m.toFixed(m<10?2:1)} m` : `${(m*3.28084).toFixed((m*3.28084)<10?2:1)} ft`;
}

function formatArea(sqm){
  if (sqm==null || isNaN(sqm)) return '—';
  if (currentUnits()==='metric') return sqm>=10000 ? `${(sqm/10000).toFixed(2)} ha` : `${sqm.toFixed(1)} m²`;
  const sqft = sqm*10.7639;
  return sqft>=43560 ? `${(sqft/43560).toFixed(2)} ac` : `${sqft.toFixed(0)} ft²`;
}

document.querySelectorAll('.units-toggle').forEach(btn=>{ btn.textContent = currentUnits()==='metric' ? 'm' : 'ft'; });


// ══ OUTDOOR / HIGH-CONTRAST MODE ══ — independent of light/dark theme, see CSS for what it
// overrides. Deliberately NOT persisted and deliberately NOT in the Settings modal, unlike
// Theme/Units/Density/Map style/Export format/snapping above, which all do carry across sessions.
// Outdoor mode is a situational squint-in-bright-sun toggle, not a standing preference — a crew
// that flips it on for a midday walk shouldn't come back the next morning indoors to a UI that's
// still in high-contrast mode for no visible reason. It stays a one-tap header/control-pill icon
// (see contrastToggleLanding/Pm/App) rather than a modal row, since it's the one control here
// that genuinely needs to be reachable in a single glance-and-tap rather than two taps into
// Settings — every session simply starts with it off.
function applyContrast(on){
  document.documentElement.toggleAttribute('data-contrast', on);
  if (on) document.documentElement.setAttribute('data-contrast','high');
  document.querySelectorAll('.contrast-toggle').forEach(btn=>btn.classList.toggle('active', on));
}

function toggleContrast(){
  const on = document.documentElement.getAttribute('data-contrast') !== 'high';
  applyContrast(on);
}

// ══ DENSITY (compact / comfortable) ══ — independent of theme/contrast. Compact trims the
// padding on tiles, dashboard action rows, and cards so more of the project fits on screen at
// once — useful once a project has a lot of feature types or a long Recent Activity list.
const DENSITY_KEY = 'plotedge_density';

function applyDensity(compact){
  document.documentElement.toggleAttribute('data-density', compact);
  if (compact) document.documentElement.setAttribute('data-density','compact');
}

// toggleDensity() removed for the same reason as toggleTheme() — setDensityPref() below is the
// only entry point, and it takes an explicit mode from the Settings segmented control.
function setDensityPref(mode){
  applyDensity(mode==='compact');
  showToast(mode==='compact' ? 'Compact view' : 'Comfortable view');
  syncSettingsModalUI();
}

(function(){
  let stored = null;
  try { stored = localStorage.getItem(DENSITY_KEY); } catch(e) {}
  if (stored === '1') applyDensity(true);
})();

// No restore-from-storage step for Contrast — every session starts with outdoor mode off, by
// design (see the comment above applyContrast/toggleContrast).

// ══ SETTINGS MODAL ══ — consolidates the existing units/density icon toggles above with two
// preferences that didn't have a home before: a default map style (previously only changeable
// from inside the Review tab's own basemap button, with no way to set it ahead of time) and a
// default export format (previously the Export tab always opened on GeoJSON regardless of what
// was used last time).
// Settings gets its own ambience band, and restores whatever the screen underneath was using on
// close — otherwise closing the sheet on the Map tab would leave the mesh switched back on over
// the satellite tiles.
let _screenBeforeSettings = null;

function openSettings(){
  syncSettingsModalUI();
  _screenBeforeSettings = currentScreenState();
  setScreenState('settings');
  document.getElementById('settingsModal').classList.add('show');
}

function closeSettings(){
  document.getElementById('settingsModal').classList.remove('show');
  if (_screenBeforeSettings) { setScreenState(_screenBeforeSettings); _screenBeforeSettings = null; }
}

// Paints every control in the modal from current state — called on open, and after any change
// made elsewhere (the quick icon toggles) so the modal never shows a stale selection if it was
// left open in another tab/window, or opened again later in the same session.
function syncSettingsModalUI(){
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  syncDomainPickerUI();
  const mode = currentThemeMode();
  const ta = document.getElementById('settingsThemeAuto'), tl = document.getElementById('settingsThemeLight'), td = document.getElementById('settingsThemeDark');
  if (ta && tl && td) { ta.classList.toggle('active', mode==='auto'); tl.classList.toggle('active', mode==='light'); td.classList.toggle('active', mode==='dark'); }
  const units = currentUnits();
  const um = document.getElementById('settingsUnitsMetric'), ui = document.getElementById('settingsUnitsImperial');
  if (um && ui) { um.classList.toggle('active', units==='metric'); ui.classList.toggle('active', units==='imperial'); }
  const basemap = defaultBasemapPref();
  const bs = document.getElementById('settingsBasemapStreet'), bt = document.getElementById('settingsBasemapSatellite');
  if (bs && bt) { bs.classList.toggle('active', basemap==='street'); bt.classList.toggle('active', basemap==='satellite'); }
  const compact = document.documentElement.getAttribute('data-density')==='compact';
  const dc = document.getElementById('settingsDensityComfortable'), dk = document.getElementById('settingsDensityCompact');
  if (dc && dk) { dc.classList.toggle('active', !compact); dk.classList.toggle('active', compact); }
  const sel = document.getElementById('settingsExportFormat');
  if (sel) sel.value = defaultExportFormat();
  const snapToggle = document.getElementById('settingsSnapToggle');
  if (snapToggle) snapToggle.checked = snapPref();
  // Reflect the stored PlotLens preference whenever Settings opens, and keep the Review entry
  // point in step with it — the toggle and the button it governs must never disagree.
  syncPlotLensEntry();
}

// ── PlotEtch snapping ── on by default: a crew digitizing adjacent parcels almost always wants
// shared edges to actually coincide, and the failure mode of snapping-off (slivers between
// polygons that only show up in QGIS later) is far more expensive than the failure mode of
// snapping-on (a vertex lands 2m from where you tapped, immediately visible and undoable).
const SNAP_KEY = 'plotedge_snap';

function snapPref(){ try{ return localStorage.getItem(SNAP_KEY) !== '0'; }catch(e){ return true; } }

function setSnapPref(on){ try{ localStorage.setItem(SNAP_KEY, on ? '1' : '0'); }catch(e){} showToast(on ? 'Snapping on' : 'Snapping off'); }

// ── Default map style ── shares the exact localStorage key (plotedge_basemap) and in-memory
// currentBasemap variable the Review tab's own toggleBasemap() already uses (see ensureReviewMap
// further down), so setting it here and switching it from inside Review always agree with each
// other rather than tracking two separate "which basemap" preferences.
function defaultBasemapPref(){ try{ return localStorage.getItem('plotedge_basemap') || 'street'; }catch(e){ return 'street'; } }

function setBasemapPref(mode){
  try { localStorage.setItem('plotedge_basemap', mode); } catch(e) {}
  if (typeof currentBasemap !== 'undefined') currentBasemap = mode;
  // If a map is already on screen (Review tab visited this session, or the vertex-correction map
  // was opened), swap its live tile layer immediately rather than only applying next time a map
  // is created — otherwise "Satellite" in Settings wouldn't visibly do anything until later.
  if (typeof reviewMap !== 'undefined' && reviewMap && reviewMapStreetLayer && reviewMapSatelliteLayer) {
    reviewMap.removeLayer(mode==='street' ? reviewMapSatelliteLayer : reviewMapStreetLayer);
    (mode==='street' ? reviewMapStreetLayer : reviewMapSatelliteLayer).addTo(reviewMap);
    if (typeof updateBasemapToggleLabel==='function') updateBasemapToggleLabel();
  }
  showToast(mode==='street' ? 'Default map style: Street' : 'Default map style: Satellite');
  syncSettingsModalUI();
}

// ── Default export format ── the Export tab's format <select> now opens on whatever was set
// here (see the page-init hook near updateExportFormatUI() at the bottom of the file) instead of
// always resetting to GeoJSON.
const EXPORT_FORMAT_DEFAULT_KEY = 'plotedge_export_format_default';

function defaultExportFormat(){ try{ return localStorage.getItem(EXPORT_FORMAT_DEFAULT_KEY) || 'geojson'; }catch(e){ return 'geojson'; } }

function setExportFormatDefault(fmt){
  try { localStorage.setItem(EXPORT_FORMAT_DEFAULT_KEY, fmt); } catch(e) {}
  const sel = document.getElementById('exportFormatSelect');
  if (sel) { sel.value = fmt; if (typeof updateExportFormatUI==='function') updateExportFormatUI(); }
  showToast('Default export format saved');
}
