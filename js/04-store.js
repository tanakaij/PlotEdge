// ═══════════════════════════════════════════════════════════════════════════
// PlotEdge — Project store: load, write guard, rolling backup, capture draft, widget
// ═══════════════════════════════════════════════════════════════════════════
// Part of an ordered set: js/*.js are plain classic scripts loaded in filename
// order by index.html. Order matters — a file can only use top-level names
// declared in itself or in a file loaded before it. Renumbering or reordering
// them will break the app; `npm test` checks this.


// ══ STORE:BEGIN ══
// ══════════════════════════════════════════════════════════════════════════════
// PROJECT STORE — DURABILITY
// ══════════════════════════════════════════════════════════════════════════════
// This layer used to have one failure mode that could destroy a whole survey in
// a single frame, silently:
//
//   loadStore() swallowed *any* exception and returned {} with projects=[].
//   The very next persist() — and persist() runs on every vertex capture — then
//   wrote {projects:[],data:{}} straight over the top of the raw string it had
//   just failed to read. A value that was merely unparseable (and therefore
//   still fully recoverable by hand) became genuinely, permanently gone.
//
// There was also no second copy anywhere: one key, one write, no rollback. A
// write interrupted mid-flight left the only copy of the data corrupt.
//
// Three defences, in order of how often they matter:
//   1. NEVER OVERWRITE MORE THAN THE USER ASKED TO REMOVE. A save that would
//      drop every project, or empty a project that had features, is refused
//      unless the caller explicitly marks it destructive (i.e. an actual delete
//      the user confirmed). A bug, a half-initialised boot or a failed load can
//      no longer express itself as data loss.
//   2. ROLLING BACKUP. The previous good value is copied to STORAGE_BAK_KEY
//      before each write, and loadStore() falls back to it when the primary is
//      unreadable.
//   3. READ-BACK VERIFY. After writing, the value is re-read and re-parsed. A
//      truncated or rejected write is rolled back rather than left in place.
//
// None of this protects against the app being uninstalled — that deletes the
// whole data directory regardless. See scripts/patch-android-signing.py for why
// that was happening on every update, and keep exporting backups.
const STORAGE_BAK_KEY = STORAGE_KEY + '_bak';

const STORAGE_QUARANTINE_PREFIX = STORAGE_KEY + '_corrupt_';


// Set when the primary AND the backup both failed to parse. While true, the
// store is considered "unknown, not empty": writes are refused so the bytes we
// could not read are left intact for recovery.
let storeLoadFailed = false;

let storeRecoveryNote = '';


// Keeps the unreadable bytes rather than letting the next save flatten them.
// Timestamped so a second failure never clobbers the first quarantine.
function quarantineRaw(raw, why) {
  if (!raw) return;
  try {
    // Don't fill the 5 MB budget with copies — one quarantine slot is enough to
    // recover from, and a second failure usually has the same cause.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf(STORAGE_QUARANTINE_PREFIX) === 0) localStorage.removeItem(k);
    }
    localStorage.setItem(STORAGE_QUARANTINE_PREFIX + Date.now(), raw);
    console.warn('PlotEdge: quarantined unreadable store (' + why + '), ' + raw.length + ' bytes');
  } catch(e) { /* if even this fails, the guards below still refuse to overwrite */ }
}


function parseStore(raw) {
  if (!raw) return null;
  const d = JSON.parse(raw);
  if (!d || typeof d !== 'object' || !Array.isArray(d.projects)) throw new Error('unexpected shape');
  return d;
}


// ══ WHAT THE GUARD COUNTS, AND WHY IT IS *NOT* VERTICES ══
// This used to be `savedFeatures.length + currentVertices.length`, which made
// the guard fire on the single most common action in the app.
//
// currentVertices is a SCRATCHPAD. Finishing a polygon moves five vertices out
// of it and into one saved feature, so that sum goes 0+5=5 -> 1+0=1. The guard
// read the drop as "this save would drop 4 captured items", refused the write,
// and left the feature in memory but not on disk. The screen said saved; the
// next launch said nothing was ever captured. Clearing the form, cancelling an
// edit and finishing a line all tripped the same wire.
//
// The durable unit of work is a SAVED FEATURE. It only ever goes down when the
// user deletes something, and every one of those paths already passes
// {destructive:true}. Counting features (never scratch vertices) makes the
// guard fire exactly when data is genuinely about to vanish and never when the
// user completes the thing they came here to do.
function countFeatures(data) {
  let n = 0;
  for (const k in (data || {})) {
    const d = data[k] || {};
    n += (d.savedFeatures || []).length;
  }
  return n;
}

// In-progress vertices, reported for diagnostics only — deliberately kept out
// of the verdict above. See the comment there.
function countDraftVertices(data) {
  let n = 0;
  for (const k in (data || {})) {
    const d = data[k] || {};
    n += (d.currentVertices || []).length;
  }
  return n;
}


function loadStore() {
  const raw = localStorage.getItem(STORAGE_KEY);
  // 1. the primary copy
  try {
    const d = parseStore(raw);
    // Seed the write-guard cache from the copy we just parsed, so the first
    // save of the session does not have to parse the whole store again.
    if (d) { projects = d.projects; lastWritten = storeShape(d); noteStoreBytes(raw ? raw.length : 0); return d.data || {}; }
  } catch(e) {
    // 2. the rolling backup, written before the previous save
    try {
      const d = parseStore(localStorage.getItem(STORAGE_BAK_KEY));
      if (d) {
        quarantineRaw(raw, 'primary unreadable, restored from backup');
        projects = d.projects;
        storeRecoveryNote = 'Recovered ' + d.projects.length + ' project(s) from the automatic backup.';
        return d.data || {};
      }
    } catch(e2) {}
    // 3. neither copy is readable — keep the bytes and refuse to write over them
    quarantineRaw(raw, 'primary and backup both unreadable');
    storeLoadFailed = true;
    storeRecoveryNote = 'Saved data could not be read. It has been set aside untouched — export a backup before continuing.';
    projects = [];
    return {};
  }
  // migrate legacy single-session data into a project, if present
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const d = JSON.parse(legacy);
      if ((d.savedFeatures && d.savedFeatures.length) || (d.currentPoints && d.currentPoints.length)) {
        const id = 'p_' + Date.now();
        projects = [{ id, name:'Imported Session', client:'', site:'', createdAt:new Date().toISOString() }];
        return { [id]: { savedFeatures:d.savedFeatures||[], currentPoints:d.currentPoints||[], currentPhotos:d.currentPhotos||[] } };
      }
    }
  } catch(e) {}
  projects = [];
  return {};
}

let projectData = {};


// ══ STORAGE USAGE / SOFT WARNING ══
// persistStore()'s catch block only ever fires *after* localStorage is already full (too late to
// act on). This estimates usage proactively against a conservative baseline quota — Safari/iOS
// caps around 5MB, well below Chrome's much larger allowance, so warning against the tighter
// common case keeps the warning meaningful across devices — and surfaces it both as a persistent
// meter (Export tab) and a one-time-per-band toast, so a long capture session isn't nagged after
// every single vertex.
const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;

let _storageWarnBand = 0;

// ══ WHY THIS IS CACHED ══
// This used to measure by cloning the raw string into a Blob, which copies the
// entire store purely to read its size — and updateStorageWarning() runs at the end of
// every persistStore(), so every photo capture cloned megabytes to learn a
// number we already knew. The write path knows exactly how many bytes it just
// wrote, so it tells us instead of us going and looking. `.length` is the right
// measure regardless: the store is JSON of base64 and ASCII, where code units
// and bytes coincide, and browsers meter localStorage in code units anyway.
let _storeBytes = null;      // primary slot

let _backupBytes = 0;        // backup slot — also consumes the same quota

function noteStoreBytes(n) { _storeBytes = n; }

function noteBackupBytes(n) { _backupBytes = n; }

function getStorageUsageInfo(){
  let bytes = _storeBytes;
  if (bytes == null) {
    try { const raw = localStorage.getItem(STORAGE_KEY); bytes = raw ? raw.length : 0; }
    catch(e) { bytes = 0; }
    _storeBytes = bytes;
  }
  // The rolling backup is a real second copy in the same quota. Reporting only
  // the primary meant the meter read half the truth exactly when it mattered,
  // and the pre-flight check that refuses new photos would have let them
  // through until the write itself failed.
  const total = bytes + _backupBytes;
  const percent = Math.min(100, Math.round((total / STORAGE_QUOTA_BYTES) * 100));
  return { bytes: total, primaryBytes: bytes, backupBytes: _backupBytes, percent };
}

function updateStorageWarning(){
  const info = getStorageUsageInfo();
  const wrap = document.getElementById('storageMeterWrap');
  const fill = document.getElementById('storageMeterFill');
  const label = document.getElementById('storageMeterLabel');
  if (fill) fill.style.width = info.percent + '%';
  if (label) label.textContent = info.percent>=80
    ? `Storage ${info.percent}% full. Export soon to free up space`
    : `Storage ${info.percent}% used`;
  if (wrap) wrap.classList.toggle('warn', info.percent>=80);
  const bands=[80,90,95,99];
  const crossed = bands.filter(b=>info.percent>=b).pop() || 0;
  if (crossed && crossed>_storageWarnBand){
    _storageWarnBand = crossed;
    showToast(`Storage ${info.percent}% full. Export soon to free up space.`);
  } else if (info.percent<80) {
    _storageWarnBand = 0; // usage dropped back down (exported/cleared data) — allow future warnings again
  }
}


// ══ WRITE GUARD ══
// Decides whether a save is allowed to reduce what is on disk. Everything that
// only adds or edits passes straight through; only a save that would make data
// disappear has to justify itself. `destructive` is set by the handful of call
// sites where the user actually asked for the removal (delete project, clear
// all, restore-from-backup), so a genuine delete is never blocked — and a bug,
// a failed load, or a persist() that fired before state finished loading can no
// longer present itself as one.
//
// ══ WHY THIS READS A CACHE AND NOT localStorage ══
// The first version re-read and re-parsed the whole store on every save to work
// out what was currently on disk. That is fine for a store of text, and ruinous
// for one full of base64 photos: persist() runs on every photo add, so a session
// adding 20 photos to a vertex was parsing a growing multi-megabyte string
// twenty times over. Measured, it made each save touch 4x the bytes it needed
// to and turned a photo-heavy session into hundreds of megabytes of avoidable
// string churn — which on an Android WebView is exactly how you get the renderer
// killed mid-capture. What is on disk is something we already know, because we
// are the only writer: it is whatever we last successfully wrote.
let lastWritten = null;   // { projectCount, itemCount } — mirrors the disk copy


function storeShape(payload) {
  return { projectCount: payload.projects.length, itemCount: countFeatures(payload.data) };
}

function storeWriteVerdict(next, opts) {
  if (opts && opts.destructive) return { ok:true };
  if (storeLoadFailed) return { ok:false, why:'saved data could not be read on startup' };
  let prev = lastWritten;
  if (!prev) {
    // Only on the very first save of a session, or after a failed write reset
    // the cache. One parse at startup is affordable; one per save is not.
    try {
      const d = parseStore(localStorage.getItem(STORAGE_KEY));
      prev = d ? storeShape(d) : null;
    } catch(e) { prev = null; }
  }
  if (!prev) return { ok:true };                      // nothing on disk to lose
  const nextShape = storeShape(next);
  if (prev.projectCount && !nextShape.projectCount)
    return { ok:false, why:'it would remove all ' + prev.projectCount + ' project(s)' };
  // A tolerance of zero is correct here: saving, editing and capturing all
  // leave the saved-feature count the same or higher, and every real deletion
  // goes through the destructive path.
  if (prev.itemCount > nextShape.itemCount)
    return { ok:false, why:'it would drop ' + (prev.itemCount - nextShape.itemCount) + ' saved feature(s)' };
  return { ok:true };
}


// ══ ROLLING BACKUP: THROTTLED, AND ONLY WHEN IT FITS ══
// A second full copy on every save is the single most expensive thing this
// layer could do to a photo-heavy project: it doubles localStorage occupancy,
// halving how many photos fit before the quota is hit, and doubles the bytes
// written per capture. Neither is worth it, because the backup only has to be
// recent enough to save a session — not identical to the last keystroke.
// So it is written at most once a minute, and skipped entirely when the
// duplicate would not comfortably fit. The cost of skipping is losing at most a
// minute of work in a corruption that has never been observed; the cost of not
// skipping is running out of room mid-survey, which is routine.
const BACKUP_MIN_INTERVAL_MS = 60000;

const BACKUP_MAX_FRACTION = 0.35;   // of the assumed quota, so primary+backup <= 70%

let _lastBackupAt = 0;

function maybeWriteBackup(prevRaw) {
  if (!prevRaw) return;
  const now = Date.now();
  if (now - _lastBackupAt < BACKUP_MIN_INTERVAL_MS) return;
  if (prevRaw.length > STORAGE_QUOTA_BYTES * BACKUP_MAX_FRACTION) {
    // Too big to duplicate safely. Drop any stale copy rather than leaving an
    // old one that could be restored over much newer work.
    try { localStorage.removeItem(STORAGE_BAK_KEY); noteBackupBytes(0); } catch(e) {}
    return;
  }
  try { localStorage.setItem(STORAGE_BAK_KEY, prevRaw); noteBackupBytes(prevRaw.length); _lastBackupAt = now; }
  catch(e) { /* backup is best effort; never block or fail the real save */ }
}


function persistStore(opts) {
  const payload = { projects, data: projectData };
  const verdict = storeWriteVerdict(payload, opts);
  if (!verdict.ok) {
    // Loud, because a silently skipped save is its own kind of data loss — the
    // crew needs to know the screen and the disk have diverged.
    console.error('PlotEdge: refused a save because ' + verdict.why);
    showToast('Save blocked to protect your data — ' + verdict.why + '. Export a backup.');
    publishWidgetSummary();
    return false;
  }
  let next;
  try { next = JSON.stringify(payload); }
  catch(e) { showToast('Could not prepare data for saving.'); return false; }

  const prevRaw = localStorage.getItem(STORAGE_KEY);
  maybeWriteBackup(prevRaw);

  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch(e) {
    noteStoreBytes(prevRaw ? prevRaw.length : 0);
    showToast('Storage full. Export before continuing.');
    updateStorageWarning();
    publishWidgetSummary();
    return false;
  }

  // ══ READ-BACK VERIFY, CHEAPLY ══
  // A quota rejection can land as a partial write on some WebViews rather than
  // a clean throw, so the write does have to be confirmed. But re-parsing
  // megabytes of JSON to do it costs more than the save itself. A length match
  // catches truncation, which is the failure mode that actually occurs; the
  // full parse is kept only for when the lengths disagree.
  const wroteRaw = localStorage.getItem(STORAGE_KEY);
  let ok = wroteRaw != null && wroteRaw.length === next.length;
  if (!ok) { try { ok = !!parseStore(wroteRaw); } catch(e) { ok = false; } }
  if (!ok) {
    if (prevRaw) { try { localStorage.setItem(STORAGE_KEY, prevRaw); } catch(e) {} }
    lastWritten = null;   // disk state is no longer known; re-derive on next save
    noteStoreBytes(prevRaw ? prevRaw.length : 0);
    showToast('Save failed and was rolled back. Export a backup now.');
    updateStorageWarning();
    publishWidgetSummary();
    return false;
  }

  lastWritten = storeShape(payload);
  noteStoreBytes(next.length);
  updateStorageWarning();
  publishWidgetSummary();
  return true;
}


// ══════════════════════════════════════════════════════════════════════════════
// CRASH-SAFE CAPTURE DRAFT
// ══════════════════════════════════════════════════════════════════════════════
// Vertices were already durable — commitVertex() calls persist() on every tap.
// Everything else on the Collect form was not: the feature name, reference,
// assignee, notes and all the attribute values lived only in the DOM until the
// moment Save was pressed. Killing the WebView (Android reclaiming a
// backgrounded app is the common case, not just a crash) threw all of it away,
// which is why a recovered session still felt like starting over.
//
// Deliberately a SEPARATE key from the project store, for two reasons: it is
// written far more often than the store and must never risk the store's bytes,
// and a draft is disposable in a way captured data is not — if it is ever
// unreadable, dropping it silently is the right outcome, so it does not go
// through the write guard above.
const DRAFT_KEY = 'plotedge_collect_draft';


function writeDraft(draft) {
  try {
    if (!draft || !draft.projectId) return false;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, at: Date.now() }));
    return true;
  } catch(e) { return false; }   // full storage must never break the capture flow
}

function readDraft(projectId) {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || (projectId && d.projectId !== projectId)) return null;
    return d;
  } catch(e) { return null; }
}

function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch(e) {} }

// ══ STORE:END ══

// ══ ANDROID HOME SCREEN WIDGET ══
// The widget is a native AppWidgetProvider and cannot read localStorage — that lives inside the
// WebView. Capacitor's Preferences plugin writes to Android SharedPreferences ("CapacitorStorage"),
// which native code CAN read, so this mirrors a small summary out on every save. Web builds and
// any native build without the plugin simply no-op.
function publishWidgetSummary(){
  try {
    if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
    const Prefs = window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
    if (!Prefs || !Prefs.set) return;
    const id = activeProjectId || activeProjectRef;
    const p = id ? projects.find(x=>x.id===id) : null;
    const d = (p && projectData[p.id]) || {};
    const feats = (d.savedFeatures||[]).length;
    // Reuse getProjectStats().synced rather than re-deriving it. The hand-rolled version here
    // compared lastExportedAt against p.updatedAt only, which misses edits stamped on features
    // rather than the project — so a project could report "synced" on the widget while the
    // Project Manager showed it as not synced. One definition, one answer.
    const unsynced = projects.reduce((n,pr)=>{
      // skipBytes: this runs on every save and only .synced is read here.
      const st = getProjectStats(pr, { skipBytes: true });
      return n + ((st.features && !st.synced) ? 1 : 0);
    },0);
    Prefs.set({ key:'plotedge_widget', value: JSON.stringify({
      project: p ? p.name : null,
      features: feats,
      inProgress: (d.currentVertices||[]).length,
      projects: projects.length,
      unsynced,
      updatedAt: Date.now()
    })});
  } catch(e){ /* widget data is best-effort; never let it break a save */ }
}


// opts.destructive marks the save as an intentional removal the user asked for
// (a delete they confirmed), which is what lets it past the write guard in
// persistStore(). Every ordinary save omits it, so a bug can never claim it.
function persist(opts) {
  if (!activeProjectId) return;
  projectData[activeProjectId] = { savedFeatures, currentVertices, featureTypes, notes: projectNotes, notesUpdatedAt: projectNotesUpdatedAt, sketches: plotetchSketches };
  // Stamp the project record too, so the Project Manager's "Modified" figure reflects every
  // capture, edit and schema change — not just the ones that happen to touch a saved feature.
  const p = projects.find(x=>x.id === activeProjectId);
  if (p) p.updatedAt = new Date().toISOString();
  // Returns persistStore()'s verdict so callers that just added something
  // expensive (a photo) can undo it rather than showing work that is not on
  // disk. Callers that don't care can keep ignoring it.
  return persistStore(opts);
}


// ══ MIGRATION: old {points:[...], photos:[...]} feature shape -> new {vertices:[...]} shape ══
// Old features had one shared photo set per feature and no per-vertex attrs. We fold that
// photo set into the first vertex so old data keeps displaying/exporting exactly as it used to
// (single-point-single-photo is just the simplest case of the new vertex model).
function migrateFeatureToVertices(f) {
  if (f.vertices) return f;
  const photos = f.photos || [];
  const pts = f.points || [];
  f.vertices = pts.map((p,i)=>({ lat:p.lat, lon:p.lon, alt:p.alt, acc:p.acc, time:p.time, attrs:{}, photos: i===0 ? photos : [] }));
  f.geometryType = f.geometryType || 'point';
  delete f.points; delete f.photos;
  return f;
}

function migrateCurrentVertices(d) {
  if (d.currentVertices) return d.currentVertices;
  const pts = d.currentPoints || [];
  const photos = d.currentPhotos || [];
  return pts.map((p,i)=>({ lat:p.lat, lon:p.lon, alt:p.alt, acc:p.acc, time:p.time, attrs:{}, photos: i===0 ? photos : [] }));
}
