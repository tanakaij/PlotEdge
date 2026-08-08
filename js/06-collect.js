// ═══════════════════════════════════════════════════════════════════════════
// PlotEdge — Collect tab: feature type select, attributes, scanner, tabs, accordion
// ═══════════════════════════════════════════════════════════════════════════
// Part of an ordered set: js/*.js are plain classic scripts loaded in filename
// order by index.html. Order matters — a file can only use top-level names
// declared in itself or in a file loaded before it. Renumbering or reordering
// them will break the app; `npm test` checks this.


// ══ REFERENCE ID AUTO-GENERATION ══
// One less thing to type per capture: picking a feature type fills Reference ID with
// TYPE-001/TYPE-002/... (sequential per type, based on how many of that type are already saved
// in this project). Fully editable — typing over it is respected on later type changes.
let refIdAutoFilled = null; // last value *we* wrote, so we can tell a user edit apart from our own autofill

function generateReferenceId(ft){
  if (!ft) return '';
  const prefix = (ft.name||'FEAT').toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,6) || 'FEAT';
  const count = savedFeatures.filter(f=>f.featureTypeId===ft.id).length + 1;
  return `${prefix}-${String(count).padStart(3,'0')}`;
}

function autofillReferenceId(ft){
  if (editingFeatureId) return; // never touch an existing feature's already-saved Reference ID
  const input = document.getElementById('featureRef');
  if (!input) return;
  const current = input.value.trim();
  if (current !== '' && current !== refIdAutoFilled) return; // user typed their own — leave it alone
  refIdAutoFilled = generateReferenceId(ft);
  input.value = refIdAutoFilled;
}


// ══ FEATURE TYPE SELECT (Collect tab) ══
let activeVertexFields = []; // this project type's fields with scope==='vertex' — rendered per-captured-vertex in the Vertex Details card


function populateFeatureTypeSelect() {
  const sel = document.getElementById('featureTypeSelect');
  const card = document.getElementById('noFeatureTypesCard');
  const banner = document.getElementById('noFtBanner');
  const triggerBtn = document.getElementById('featureTypePickerBtn');
  if (!featureTypes.length) {
    sel.innerHTML = '';
    sel.disabled = true;
    triggerBtn.disabled = true;
    document.getElementById('featureTypePickerLabel').textContent = 'No feature types yet';
    document.getElementById('featureTypePickerGlyph').textContent = '';
    card.style.display = '';
    if (banner) banner.style.display = '';
    document.getElementById('attrFields').innerHTML = '';
    document.getElementById('geoTag').textContent = '—';
    document.getElementById('captureBtn').disabled = true;
    document.getElementById('saveFeatureBtn').disabled = true;
    return;
  }
  card.style.display = 'none';
  if (banner) banner.style.display = 'none';
  sel.disabled = false;
  triggerBtn.disabled = false;
  sel.innerHTML = featureTypes.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  onFeatureTypeChange();
}


// ══ FEATURE TYPE PICKER MODAL ══
// A big-target modal list standing in for the hidden native <select> above — see the CSS comment
// (search "FEATURE TYPE PICKER") for why rows instead of the fixed 3-way geo-opt pills.
const ftPickerGlyph = { point:'●', line:'—', polygon:'▱' };

function openFeatureTypePicker(){
  if (document.getElementById('featureTypePickerBtn').disabled) return;
  const sel = document.getElementById('featureTypeSelect');
  const list = document.getElementById('featureTypePickerList');
  list.innerHTML = featureTypes.map(t => {
    const isSel = t.id === sel.value;
    return `<div class="ft-picker-row ${isSel?'sel':''}" onclick="selectFeatureTypeFromPicker('${t.id}')">
      <div class="ft-picker-row-glyph">${ftPickerGlyph[t.geometryType]||''}</div>
      <div class="ft-picker-row-text">
        <div class="ft-picker-row-name">${escapeHtml(t.name)}</div>
        <div class="ft-picker-row-meta">${escapeHtml(t.geometryType)} · ${t.fields.length} field${t.fields.length===1?'':'s'}</div>
      </div>
      <div class="ft-picker-row-check">✓</div>
    </div>`;
  }).join('');
  document.getElementById('featureTypePickerModal').classList.add('show');
}

function closeFeatureTypePicker(){
  document.getElementById('featureTypePickerModal').classList.remove('show');
}

function selectFeatureTypeFromPicker(id){
  const sel = document.getElementById('featureTypeSelect');
  sel.value = id;
  closeFeatureTypePicker();
  onFeatureTypeChange();
  // Picking the type is the moment attention should move to the fix — that is the whole reason
  // GPS & Capture was ordered second. Advancing the accordion here saves the crew a scroll and a
  // tap on every single feature, and only fires on an explicit pick (not on the programmatic
  // onFeatureTypeChange() calls that run during project load or edit prefill).
  openCollectStep('collectCardGps', true);
}

function updateFeatureTypePickerTrigger(ft){
  document.getElementById('featureTypePickerGlyph').textContent = ftPickerGlyph[ft.geometryType] || '';
  document.getElementById('featureTypePickerLabel').textContent = ft.name;
}


function onFeatureTypeChange() {
  const sel = document.getElementById('featureTypeSelect');
  const ft = getFeatureType(sel.value);
  if (!ft) return;
  updateFeatureTypePickerTrigger(ft);
  const tag = document.getElementById('geoTag');
  tag.textContent = ft.geometryType.charAt(0).toUpperCase() + ft.geometryType.slice(1);
  autofillReferenceId(ft);

  const featureFields = ft.fields.filter(f => f.scope !== 'vertex');
  activeVertexFields = ft.fields.filter(f => f.scope === 'vertex');

  const container = document.getElementById('attrFields');
  const noMsg = document.getElementById('noFeatureAttrsMsg');
  const notesField = document.getElementById('notesField');
  // While editing an existing feature of this same type, prefill each field with its saved value
  const prefillAttrs = (editingFeatureId && editingFeatureSnapshot && editingFeatureSnapshot.featureTypeId === ft.id) ? (editingFeatureSnapshot.attrs || {}) : null;
  if (!featureFields.length) {
    container.innerHTML = '';
    noMsg.style.display = ft.fields.length ? '' : 'none';
    notesField.style.borderTop = 'none';
    notesField.style.marginTop = '0';
    notesField.style.paddingTop = '0';
  } else {
    noMsg.style.display = 'none';
    notesField.style.borderTop = '';
    notesField.style.marginTop = '';
    notesField.style.paddingTop = '';
    // Each field becomes its own pane so the sheet can show one at a time. renderAttrField() is
    // untouched — same markup, same `attr_<id>` ids collectAttrs() reads.
    container.innerHTML = featureFields.map(a =>
      `<div class="attr-pane" data-fid="${a.id}">${renderAttrField(a, prefillAttrs ? prefillAttrs[a.id] : undefined)}</div>`
    ).join('');
  }
  attrSheetFields = featureFields;
  renderAttrSummary();

  // Ad hoc attributes: when editing an existing feature, pull in anything saved on it that isn't
  // part of this type's schema (and isn't an auto-computed geom_* attr) so it's still editable;
  // for a brand-new capture, start with a clean slate.
  if (editingFeatureId && editingFeatureSnapshot && editingFeatureSnapshot.featureTypeId === ft.id) {
    const schemaIds = new Set(featureFields.map(a=>a.id));
    customFeatureAttrs = {};
    Object.keys(editingFeatureSnapshot.attrs || {}).forEach(k=>{
      if (!schemaIds.has(k) && !k.startsWith('geom_')) customFeatureAttrs[k] = editingFeatureSnapshot.attrs[k];
    });
  } else if (!editingFeatureId) {
    customFeatureAttrs = {};
  }
  renderCustomAttrsList();

  updateGeometryUI(ft);
  renderVertexEditor(); // vertex-scope fields may have changed — refresh the open vertex's editor, if any
}


// Capture/Save button labels, "needs N vertices" hint, and Finish-button gating all depend on geometry type
function updateGeometryUI(ft) {
  const geoWord = ft.geometryType === 'line' ? 'Line' : ft.geometryType === 'polygon' ? 'Polygon' : 'Point';
  const min = ft.geometryType === 'polygon' ? 3 : ft.geometryType === 'line' ? 2 : 1;
  document.getElementById('captureBtnLabel').textContent = ft.geometryType === 'point'
    ? 'Capture Point' : `Capture Vertex ${currentVertices.length + 1}`;
  document.getElementById('saveFeatureBtnLabel').textContent = editingFeatureId
    ? 'Save Changes'
    : (ft.geometryType === 'point' ? 'Save Feature' : `Finish ${geoWord}`);
  // Live length/area preview while capturing — same computeGeometryAttrs() used at save time, so
  // what's shown here always matches what actually gets written to the feature.
  let measureText = '';
  if (ft.geometryType==='line' && currentVertices.length>=2){
    measureText = ` · ${formatLength(lineLengthM(currentVertices))}`;
  } else if (ft.geometryType==='polygon' && currentVertices.length>=3){
    measureText = ` · ${formatArea(polygonAreaAndPerimeterM(currentVertices).area)}`;
  }
  document.getElementById('geoMinHint').textContent = ft.geometryType === 'point' ? '' : `(needs ${min}+ vertices)${measureText}`;
  document.getElementById('saveFeatureBtn').disabled = currentVertices.length < min;
  // Reinforce what Start/End mean geometrically for a polygon once there's enough of a ring
  // forming (2+ vertices) that "closing" it is a meaningful next step.
  document.getElementById('closeRingHint').classList.toggle('show', ft.geometryType === 'polygon' && currentVertices.length >= 2);
  document.getElementById('swipeHint').style.display = currentVertices.length ? '' : 'none';
  updateCaptureStrip();
}


function renderAttrField(a, val) {
  const req = a.required ? ' <span class="hint">(required)</span>' : ' <span class="hint">(optional)</span>';
  const label = `<label>${escapeHtml(a.label)}${req}</label>`;
  if (a.type === 'single_select') {
    const opts = (a.options||[]).map(o => `<option value="${escapeHtml(o)}" ${val===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
    return `<div class="field"><label>${escapeHtml(a.label)}</label><div class="select-wrap"><select id="attr_${a.id}">${opts}</select></div></div>`;
  }
  if (a.type === 'multi_select') {
    const sel = Array.isArray(val) ? val : [];
    const chips = (a.options||[]).map(o => `<div class="chip-opt ${sel.includes(o)?'sel':''}" data-val="${escapeHtml(o)}" onclick="this.classList.toggle('sel')">${escapeHtml(o)}</div>`).join('');
    return `<div class="field"><label>${escapeHtml(a.label)}</label><div class="chip-select" id="attr_${a.id}">${chips}</div></div>`;
  }
  if (a.type === 'boolean') {
    return `<div class="field"><label>${escapeHtml(a.label)}</label><div class="bool-toggle" id="attr_${a.id}" data-val="${val===true?'true':val===false?'false':''}">
      <div class="bool-opt ${val===true?'sel-yes':''}" onclick="setBoolField('${a.id}',true)">Yes</div>
      <div class="bool-opt ${val===false?'sel-no':''}" onclick="setBoolField('${a.id}',false)">No</div>
    </div></div>`;
  }
  if (a.type === 'number') {
    return `<div class="field">${label}<input type="number" id="attr_${a.id}" value="${val!=null?escapeHtml(String(val)):''}" placeholder="${escapeHtml(a.placeholder||'0')}" step="any"></div>`;
  }
  if (a.type === 'date') {
    return `<div class="field">${label}<input type="date" id="attr_${a.id}" value="${escapeHtml(val||'')}"></div>`;
  }
  if (a.type === 'textarea') {
    return `<div class="field">${label}<textarea id="attr_${a.id}" placeholder="${escapeHtml(a.placeholder||'')}">${escapeHtml(val||'')}</textarea></div>`;
  }
  if (a.type === 'barcode') {
    return `<div class="field">${label}<div class="barcode-row"><input type="text" id="attr_${a.id}" value="${escapeHtml(val||'')}" placeholder="${escapeHtml(a.placeholder||'Scan or type a code')}"><button type="button" class="barcode-scan-btn" onclick="openBarcodeScanner('attr_${a.id}')" title="Scan barcode/QR" aria-label="Scan barcode or QR code"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/><line x1="17" y1="8" x2="17" y2="16"/></svg></button></div></div>`;
  }
  return `<div class="field">${label}<input type="text" id="attr_${a.id}" value="${escapeHtml(val||'')}" placeholder="${escapeHtml(a.placeholder||'')}"></div>`;
}


function setBoolField(id, val) {
  const wrap = document.getElementById('attr_' + id);
  wrap.dataset.val = String(val);
  wrap.querySelectorAll('.bool-opt').forEach((el,i)=>{
    el.classList.remove('sel-yes','sel-no');
    if ((i===0 && val===true) || (i===1 && val===false)) el.classList.add(val ? 'sel-yes' : 'sel-no');
  });
}


// Feature-wide attrs only (scope!=='vertex') — gathered once at Save time, same as the original single-point flow
// ══ ATTRIBUTE SUMMARY + SHEET ══
// attrSheetFields mirrors the feature-scoped fields currently rendered into #attrFields.
let attrSheetFields = [], attrSheetIdx = 0;


// Reads the live input for a field and returns a display string. Deliberately reads the DOM
// rather than a parallel state object: the inputs are the single source of truth here (that's
// what collectAttrs does at save), so a preview built from anything else could disagree with
// what actually gets saved.
function attrValuePreview(a){
  const el = document.getElementById('attr_' + a.id);
  if (!el) return '';
  if (a.type === 'boolean'){
    const v = el.dataset.val;
    return v === 'true' ? 'Yes' : v === 'false' ? 'No' : '';
  }
  if (a.type === 'multi_select'){
    // .chip-opt, not .chip — renderAttrField emits `<div class="chip-opt sel">`. The wrong
    // selector matched nothing, so every multi-select summary read as empty no matter what was
    // ticked, and the required-but-empty highlight fired on fields that were actually filled.
    return [...el.querySelectorAll('.chip-opt.sel')].map(c=>c.textContent.trim()).join(', ');
  }
  return (el.value || '').trim();
}


function renderAttrSummary(){
  const el = document.getElementById('attrSummary');
  if (!el) return;
  el.innerHTML = attrSheetFields.map((a,i) => {
    const v = attrValuePreview(a);
    const empty = !v;
    return `<div class="attr-sum-row${a.required && empty ? ' needs-value' : ''}" role="button" tabindex="0" onclick="openAttrSheet(${i})">
      <div class="attr-sum-body">
        <div class="attr-sum-label">${escapeHtml(a.label)}${a.required?'<span class="sum-pill req">REQUIRED</span>':''}</div>
        <div class="attr-sum-val${empty?' is-empty':''}">${empty ? (a.placeholder ? escapeHtml(a.placeholder) : 'Not set') : escapeHtml(v)}</div>
      </div>
      <span class="attr-sum-chev"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
    </div>`;
  }).join('');
}


function openAttrSheet(idx){
  if (!attrSheetFields.length) return;
  attrSheetIdx = Math.max(0, Math.min(idx, attrSheetFields.length - 1));
  showAttrPane();
  document.getElementById('attrSheet').classList.add('show');
  // No pushNavState here. Overlays in this app are not history stops — closeTopOverlay() handles
  // Back for them and returns without popping, so a pushed state would never be consumed and the
  // next Back press would silently burn it instead of navigating.
}

function showAttrPane(){
  const a = attrSheetFields[attrSheetIdx];
  if (!a) return;
  document.querySelectorAll('#attrFields .attr-pane').forEach(p =>
    p.classList.toggle('active', p.dataset.fid === a.id));
  document.getElementById('attrSheetTitle').textContent = a.label || 'Attribute';
  document.getElementById('attrSheetStep').textContent =
    'FIELD ' + (attrSheetIdx + 1) + ' OF ' + attrSheetFields.length;
  document.getElementById('attrSheetPrev').disabled = attrSheetIdx === 0;
  const next = document.getElementById('attrSheetNext');
  // On the last field Next becomes the way out, so the whole schema can be filled in one pass
  // without reaching for Done — the common case is stepping straight through.
  next.textContent = attrSheetIdx === attrSheetFields.length - 1 ? 'Finish' : 'Next';
  const input = document.querySelector('#attrFields .attr-pane.active input, #attrFields .attr-pane.active textarea');
  if (input) setTimeout(()=>input.focus(), 90);
}

function attrSheetNav(delta){
  const target = attrSheetIdx + delta;
  if (target < 0) return;
  if (target >= attrSheetFields.length){ closeAttrSheet(); return; }
  attrSheetIdx = target;
  showAttrPane();
  renderAttrSummary();
}

function closeAttrSheet(){
  document.getElementById('attrSheet').classList.remove('show');
  renderAttrSummary();
  // Step 3's badge keys off "any attribute non-empty", which can only have changed here.
  // (updateStepBadges never existed — the guard meant the badge simply never refreshed.)
  if (typeof updateCollectStepStatus === 'function') updateCollectStepStatus();
}


function collectAttrs(ft) {
  const attrs = {};
  if (!ft) return attrs;
  ft.fields.filter(a => a.scope !== 'vertex').forEach(a => {
    const el = document.getElementById('attr_' + a.id);
    if (!el) return;
    if (a.type === 'multi_select') {
      attrs[a.id] = Array.from(el.querySelectorAll('.chip-opt.sel')).map(c => c.dataset.val);
    } else if (a.type === 'boolean') {
      attrs[a.id] = el.dataset.val === 'true' ? true : el.dataset.val === 'false' ? false : null;
    } else {
      attrs[a.id] = el.value;
    }
  });
  Object.assign(attrs, customFeatureAttrs);
  return attrs;
}


// ══ AD HOC ATTRIBUTES ══ — lets a field crew tack on an attribute this feature type's schema
// doesn't define, without stopping to edit the schema. Kept in a separate runtime object rather
// than injected into ft.fields, so it never touches the shared schema other features rely on;
// it's just merged into this one feature's attrs on save (see collectAttrs above).
let customFeatureAttrs = {};

function renderCustomAttrsList(){
  const wrap = document.getElementById('customAttrsList');
  if (!wrap) return;
  const keys = Object.keys(customFeatureAttrs);
  wrap.innerHTML = keys.map(k => `<div class="field">
    <label>${escapeHtml(k)} <span class="hint">(added on the go)</span></label>
    <div style="display:flex;gap:8px;">
      <input type="text" value="${escapeHtml(customFeatureAttrs[k])}" oninput="setCustomAttr('${k.replace(/'/g,"\\'")}', this.value)" style="flex:1;">
      <button type="button" class="feat-del" onclick="removeCustomAttr('${k.replace(/'/g,"\\'")}')" title="Remove attribute" style="flex-shrink:0;">✕</button>
    </div>
  </div>`).join('');
}

function setCustomAttr(key, value){ customFeatureAttrs[key] = value; }

function removeCustomAttr(key){ delete customFeatureAttrs[key]; renderCustomAttrsList(); }

function promptAddCustomAttr(){
  const name = (prompt('Attribute name (e.g. "Condition")') || '').trim();
  if (!name) return;
  if (name.toLowerCase().startsWith('geom_')) { showToast('That name is reserved for auto-computed geometry attributes'); return; }
  const value = (prompt(`Value for "${name}"`) || '').trim();
  customFeatureAttrs[name] = value;
  renderCustomAttrsList();
}


// ══ VERTEX-SCOPE ATTRS (per captured vertex — written live as the user fills the Vertex Details card) ══
function setVertexAttr(vIdx, fieldId, value) {
  if (!currentVertices[vIdx]) return;
  currentVertices[vIdx].attrs = currentVertices[vIdx].attrs || {};
  currentVertices[vIdx].attrs[fieldId] = value;
  persist();
}

function setVertexBoolField(vIdx, fieldId, val) {
  const wrap = document.getElementById(`vattr_${vIdx}_${fieldId}`);
  if (wrap) {
    wrap.dataset.val = String(val);
    wrap.querySelectorAll('.bool-opt').forEach((el,i)=>{
      el.classList.remove('sel-yes','sel-no');
      if ((i===0 && val===true) || (i===1 && val===false)) el.classList.add(val ? 'sel-yes' : 'sel-no');
    });
  }
  setVertexAttr(vIdx, fieldId, val);
}

function toggleVertexMultiChip(vIdx, fieldId, el) {
  el.classList.toggle('sel');
  const wrap = document.getElementById(`vattr_${vIdx}_${fieldId}`);
  const vals = Array.from(wrap.querySelectorAll('.chip-opt.sel')).map(c => c.dataset.val);
  setVertexAttr(vIdx, fieldId, vals);
}

function renderVertexAttrField(a, vIdx, val) {
  const req = a.required ? ' <span class="hint">(required)</span>' : ' <span class="hint">(optional)</span>';
  const label = `<label>${escapeHtml(a.label)}${req}</label>`;
  const id = `vattr_${vIdx}_${a.id}`;
  if (a.type === 'single_select') {
    const opts = (a.options||[]).map(o => `<option value="${escapeHtml(o)}" ${val===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
    return `<div class="field">${label}<div class="select-wrap"><select id="${id}" onchange="setVertexAttr(${vIdx},'${a.id}',this.value)">${opts}</select></div></div>`;
  }
  if (a.type === 'multi_select') {
    const sel = Array.isArray(val) ? val : [];
    const chips = (a.options||[]).map(o => `<div class="chip-opt ${sel.includes(o)?'sel':''}" data-val="${escapeHtml(o)}" onclick="toggleVertexMultiChip(${vIdx},'${a.id}',this)">${escapeHtml(o)}</div>`).join('');
    return `<div class="field">${label}<div class="chip-select" id="${id}">${chips}</div></div>`;
  }
  if (a.type === 'boolean') {
    return `<div class="field">${label}<div class="bool-toggle" id="${id}" data-val="${val===true?'true':val===false?'false':''}">
      <div class="bool-opt ${val===true?'sel-yes':''}" onclick="setVertexBoolField(${vIdx},'${a.id}',true)">Yes</div>
      <div class="bool-opt ${val===false?'sel-no':''}" onclick="setVertexBoolField(${vIdx},'${a.id}',false)">No</div>
    </div></div>`;
  }
  if (a.type === 'number') {
    return `<div class="field">${label}<input type="number" id="${id}" value="${val!=null?escapeHtml(String(val)):''}" placeholder="${escapeHtml(a.placeholder||'0')}" step="any" oninput="setVertexAttr(${vIdx},'${a.id}',this.value)"></div>`;
  }
  if (a.type === 'date') {
    return `<div class="field">${label}<input type="date" id="${id}" value="${escapeHtml(val||'')}" onchange="setVertexAttr(${vIdx},'${a.id}',this.value)"></div>`;
  }
  if (a.type === 'textarea') {
    return `<div class="field">${label}<textarea id="${id}" placeholder="${escapeHtml(a.placeholder||'')}" oninput="setVertexAttr(${vIdx},'${a.id}',this.value)">${escapeHtml(val||'')}</textarea></div>`;
  }
  if (a.type === 'barcode') {
    return `<div class="field">${label}<div class="barcode-row"><input type="text" id="${id}" value="${escapeHtml(val||'')}" placeholder="${escapeHtml(a.placeholder||'Scan or type a code')}" oninput="setVertexAttr(${vIdx},'${a.id}',this.value)"><button type="button" class="barcode-scan-btn" onclick="openBarcodeScanner('${id}')" title="Scan barcode/QR" aria-label="Scan barcode or QR code"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/><line x1="17" y1="8" x2="17" y2="16"/></svg></button></div></div>`;
  }
  return `<div class="field">${label}<input type="text" id="${id}" value="${escapeHtml(val||'')}" placeholder="${escapeHtml(a.placeholder||'')}" oninput="setVertexAttr(${vIdx},'${a.id}',this.value)"></div>`;
}


// ══ BARCODE / QR SCANNER ══ — uses the browser's built-in BarcodeDetector (Chrome/Edge/Android,
// no library, no network call). On browsers without it (Safari/iOS as of this writing) the scan
// button just tells the person to type the code instead — the field itself is a normal text input
// either way, so nothing is ever blocked on scanning working.
let barcodeScanStream = null;

let barcodeScanTargetId = null;

let barcodeScanRAF = null;

async function openBarcodeScanner(targetInputId) {
  if (!('BarcodeDetector' in window)) {
    showToast('Barcode scanning isn\'t supported on this browser — you can still type the code in');
    return;
  }
  barcodeScanTargetId = targetInputId;
  const overlay = document.getElementById('barcodeScannerOverlay');
  const video = document.getElementById('barcodeScannerVideo');
  const hint = document.getElementById('barcodeScannerHint');
  try {
    barcodeScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    showToast('Camera access denied or unavailable');
    return;
  }
  video.srcObject = barcodeScanStream;
  overlay.classList.add('show');
  hint.textContent = 'Line the code up inside the frame';
  let detector;
  try {
    detector = new BarcodeDetector();
  } catch (e) {
    showToast('Barcode scanning isn\'t supported on this browser — you can still type the code in');
    closeBarcodeScanner();
    return;
  }
  const scanLoop = async () => {
    if (!barcodeScanStream) return; // closed mid-loop
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length) {
        const value = codes[0].rawValue;
        const input = document.getElementById(barcodeScanTargetId);
        if (input) {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showToast('Scanned: ' + value);
        closeBarcodeScanner();
        return;
      }
    } catch (e) { /* keep trying — a stray decode error shouldn't kill the loop */ }
    barcodeScanRAF = requestAnimationFrame(scanLoop);
  };
  barcodeScanRAF = requestAnimationFrame(scanLoop);
}

function closeBarcodeScanner() {
  if (barcodeScanRAF) cancelAnimationFrame(barcodeScanRAF);
  barcodeScanRAF = null;
  if (barcodeScanStream) { barcodeScanStream.getTracks().forEach(t => t.stop()); barcodeScanStream = null; }
  document.getElementById('barcodeScannerOverlay').classList.remove('show');
  barcodeScanTargetId = null;
}


// ══ TABS (within a project) ══
function toggleCard(id){
  const card = document.getElementById(id);
  if(!card) return;
  card.classList.toggle('collapsed');
}

// Moves the single shared #reviewMap Leaflet instance between the Dashboard preview slot and its
// home position on the Review tab, rather than standing up a second map (and downloading a second
// set of tiles) for the dashboard — this app is built to work offline on field data plans, so a
// duplicate map would be a real cost for what's meant to be a lightweight "here's your coverage"
// glance. invalidateSize() is required after the move: Leaflet lays tiles out for the container
// size at the moment it becomes visible, and the dashboard/review slots are different heights.
function dockReviewMap(destination){
  const wrap = document.getElementById('reviewMapWrap');
  const dashSlot = document.getElementById('dashMapSlot');
  const anchor = document.getElementById('reviewMapAnchor');
  if (!wrap || !dashSlot || !anchor) return;
  if (destination === 'dashboard') {
    dashSlot.appendChild(wrap);
    wrap.classList.add('dash-preview');
  } else if (destination === 'review') {
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    wrap.classList.remove('dash-preview');
  } else {
    return;
  }
  setTimeout(() => { if (reviewMap) reviewMap.invalidateSize(); }, 60);
}

// ══ COLLECT DATA-ENTRY CHROME ══
// The bottom nav bar (and the ~56-64dp it occupies) is only useful while browsing between tabs —
// on Collect it's just something to accidentally hit while filling out the form or tapping
// Capture Point. enterCollectDataEntry() slides it out of view (see the .collect-nav-hidden CSS
// above .bottom-nav) and now runs for the whole Collect tab (switchTab() calls it on entry, not
// just on field focus); exitCollectDataEntry() brings it back the moment another tab is opened.
// The header's existing ← Back button (headerBackTap → switchTabNav) keeps working throughout
// since it lives above the fold, not in the bottom bar.
let collectDataEntryActive = false;

function enterCollectDataEntry(){
  if (collectDataEntryActive) return;
  const collectPanel = document.getElementById('panel-collect');
  if (!collectPanel || !collectPanel.classList.contains('active')) return;
  collectDataEntryActive = true;
  document.body.classList.add('collect-nav-hidden');
}

function exitCollectDataEntry(){
  if (!collectDataEntryActive) return;
  collectDataEntryActive = false;
  document.body.classList.remove('collect-nav-hidden');
}

// Delegated rather than bound to individual fields, so newly-rendered inputs (attribute fields,
// custom attrs, vertex editor fields) pick this up automatically with no extra wiring.
(function(){
  const collectPanel = document.getElementById('panel-collect');
  if (!collectPanel) return;
  collectPanel.addEventListener('focusin', e => {
    if (e.target.matches('input, textarea, select')) enterCollectDataEntry();
  });
})();


function switchTab(name) {
  // Recorded here rather than in switchTabNav(), so it stays correct even when
  // a tab is entered programmatically. See noteCurrentTab().
  noteCurrentTab(name);
  // ══ AMBIENT INTENSITY ══ Collect is the data-entry screen (inputs must stay sharp in sun);
  // Review is the map canvas (no tint over satellite tiles at all); everything else is ambient.
  // Shared with activateView('view-app') so entering a project and switching tabs inside it can
  // never disagree about which band applies.
  switchTabScreenState(name);
  if (name !== 'collect') exitCollectDataEntry();
  const tabs = ['dashboard','collect','review','import','export'];
  document.querySelectorAll('.nav-btn[id^="navBtn-"]').forEach(b=>b.classList.toggle('active', b.id==='navBtn-'+name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id==='panel-'+name));
  // Collect is a full-screen capture workflow — the bottom nav bar should stay out of the way for
  // the whole tab, not just once a field is focused. enterCollectDataEntry() is idempotent (it
  // no-ops if already active), so calling it here on every entry is safe; the focusin listener
  // further down still covers it defensively in case switchTab() is ever bypassed.
  if (name === 'collect') { enterCollectDataEntry(); resetCollectAccordion(); }
  if (name==='review'||name==='export'||name==='dashboard') updateStats();
  // syncPlotLensEntry() here rather than only on boot: the toggle can be flipped in Settings at
  // any time, and Review is the tab that hosts the entry point.
  if (name==='review') { dockReviewMap('review'); renderReviewMap(); syncPlotLensEntry(); }
  if (name==='dashboard') { dockReviewMap('dashboard'); renderReviewMap(); }
  if (name==='export') refreshExportMeta();
  // Field workflow: a GPS fix takes a few seconds to settle, so start acquiring the moment Collect
  // opens rather than waiting for a manual "Start GPS" tap — by the time the feature type/name are
  // filled in, accuracy is usually already good enough to capture. Only kicks in with a feature
  // type to collect against, and never fights an already-connected external GPS receiver.
  if (name==='collect' && !gpsActive && !extGpsActive && featureTypes.length && navigator.geolocation) startGPS();
  updateCaptureStrip();
  if (activeProjectId) saveLastSession(name);
  updateCaptureFabVisibility();
}
