// ═══════════════════════════════════════════════════════════════════════════
// PlotEdge — Geodesic maths, projections, area/length, coordinate conversion
// ═══════════════════════════════════════════════════════════════════════════
// Part of an ordered set: js/*.js are plain classic scripts loaded in filename
// order by index.html. Order matters — a file can only use top-level names
// declared in itself or in a file loaded before it. Renumbering or reordering
// them will break the app; `npm test` checks this.


// ══════════════════════════════════════════════════════════════════════════════════════════
// ANALYSIS
// ══════════════════════════════════════════════════════════════════════════════════════════
function peShowResult(title, lines, note){
  const el = document.getElementById('peResult');
  if (!el) return;
  el.innerHTML = `<div class="pe-result">
    <div class="pe-result-title">${escapeHtml(title)}</div>
    ${lines.map(l=>`<div class="pe-result-line">${l}</div>`).join('')}
    ${note?`<div class="pe-result-note">${escapeHtml(note)}</div>`:''}
  </div>`;
  el.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function peRequireSelected(){
  const s = peSelected();
  if (!s) showToast('Select a sketch first');
  return s;
}


// ── MEASURE ── exact: haversine geodesics, not the projected plane used by the raster ops.
function peMeasure(){
  const s = peRequireSelected(); if (!s) return;
  const v = s.vertices;
  const lines = [`Type      ${s.type}`, `Vertices  ${v.length}`];
  if (s.type==='point'){
    lines.push(`Lat       ${v[0].lat.toFixed(6)}`, `Lon       ${v[0].lon.toFixed(6)}`);
  } else if (s.type==='polygon'){
    // Deliberately no "Length" row here. lineLengthM() walks an open path, so on a closed ring it
    // returns the perimeter minus the closing edge — a number that looks authoritative, sits right
    // above the real Perimeter, and means nothing. Same reason Span/Bearing are line-only: on a
    // ring, start→end is just whichever edge happens to close it.
    const r = polygonAreaAndPerimeterM(v);
    lines.push(`Perimeter ${formatLength(r.perimeter)}`);
    lines.push(`Area      ${formatArea(r.area)}`);
  } else {
    lines.push(`Length    ${formatLength(lineLengthM(v))}`);
    const a=v[0], b=v[v.length-1];
    lines.push(`Span      ${formatLength(haversineM(a.lat,a.lon,b.lat,b.lon))}`);
    lines.push(`Bearing   ${peBearing(a,b).toFixed(1)}° (start→end)`);
  }
  peShowResult(`Measure — ${s.name}`, lines);
}

// Initial great-circle bearing, normalised to 0–360.
function peBearing(a, b){
  const toRad=d=>d*Math.PI/180;
  const y = Math.sin(toRad(b.lon-a.lon))*Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat))*Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.cos(toRad(b.lon-a.lon));
  return (Math.atan2(y,x)*180/Math.PI + 360) % 360;
}


// ── CENTROID ── area-weighted for polygons (not the vertex mean, which drags toward whichever
// edge happens to be most finely digitized), length-weighted midpoint for lines.
function peCentroid(){
  const s = peRequireSelected(); if (!s) return;
  let c;
  if (s.type==='point'){
    c = { lat:s.vertices[0].lat, lon:s.vertices[0].lon };
  } else if (s.type==='polygon'){
    const proj = peProjector(s.vertices);
    const p = s.vertices.map(proj.fwd);
    let a=0, cx=0, cy=0;
    for (let i=0;i<p.length;i++){
      const q=p[i], r=p[(i+1)%p.length];
      const f = q.x*r.y - r.x*q.y;
      a += f; cx += (q.x+r.x)*f; cy += (q.y+r.y)*f;
    }
    a *= 0.5;
    c = Math.abs(a) < 1e-9
      ? proj.inv({ x:p.reduce((s2,q)=>s2+q.x,0)/p.length, y:p.reduce((s2,q)=>s2+q.y,0)/p.length })
      : proj.inv({ x:cx/(6*a), y:cy/(6*a) });
  } else {
    const half = lineLengthM(s.vertices)/2;
    let run = 0; c = { lat:s.vertices[0].lat, lon:s.vertices[0].lon };
    for (let i=1;i<s.vertices.length;i++){
      const a=s.vertices[i-1], b=s.vertices[i];
      const d = haversineM(a.lat,a.lon,b.lat,b.lon);
      if (run + d >= half){
        const t = d===0 ? 0 : (half-run)/d;
        c = { lat:a.lat+(b.lat-a.lat)*t, lon:a.lon+(b.lon-a.lon)*t };
        break;
      }
      run += d;
    }
  }
  peAddSketch('point', [c], `${s.name} centroid`, { derived:true, note:'centroid' });
  peShowResult(`Centroid — ${s.name}`, [`Lat  ${c.lat.toFixed(6)}`, `Lon  ${c.lon.toFixed(6)}`], 'Added as a new derived sketch.');
}


// ── CONVEX HULL ── exact.
function peConvexHull(){
  const s = peRequireSelected(); if (!s) return;
  if (s.vertices.length < 3){ showToast('Need at least 3 vertices for a hull'); return; }
  const proj = peProjector(s.vertices);
  const hull = peConvexHullXY(s.vertices.map(proj.fwd)).map(proj.inv);
  if (hull.length < 3){ showToast('Those vertices are collinear — no hull'); return; }
  const r = polygonAreaAndPerimeterM(hull);
  const area = r.area!=null?r.area:r.areaSqm;
  peAddSketch('polygon', hull, `${s.name} hull`, { derived:true, note:'convex hull' });
  peShowResult(`Convex hull — ${s.name}`, [
    `Input     ${s.vertices.length} vertices`,
    `Hull      ${hull.length} vertices`,
    `Area      ${formatArea(area)}`
  ], 'Added as a new derived sketch.');
}


// ── BUFFER ── raster engine; see peRasterOp.
function openBufferModal(){
  if (!peSelected()){ showToast('Select a sketch first'); return; }
  document.getElementById('bufferModal').classList.add('show');
}

function closeBufferModal(){ document.getElementById('bufferModal').classList.remove('show'); }

function runBuffer(){
  const s = peSelected(); if (!s){ closeBufferModal(); return; }
  const dist = parseFloat(document.getElementById('bufferDistInput').value);
  if (!isFinite(dist) || dist <= 0){ showToast('Enter a distance greater than zero'); return; }
  closeBufferModal();
  const proj = peProjector(s.vertices);
  const pts = s.vertices.map(proj.fwd);
  const closed = s.type==='polygon';
  const inside = p => {
    if (s.type==='point') return pts.some(q=>Math.hypot(p.x-q.x,p.y-q.y) <= dist);
    if (closed && pePointInRingXY(p, pts)) return true;
    const n = pts.length;
    const last = closed ? n : n-1;
    for (let i=0;i<last;i++){
      if (peDistToSeg(p, pts[i], pts[(i+1)%n]) <= dist) return true;
    }
    return false;
  };
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  const bbox = { minX:Math.min(...xs), maxX:Math.max(...xs), minY:Math.min(...ys), maxY:Math.max(...ys) };
  const out = peRasterOp(inside, bbox, proj, dist*1.25);
  if (!out.rings.length){ showToast('Buffer produced no area'); return; }
  const ring = out.rings[0];
  const r = polygonAreaAndPerimeterM(ring);
  peAddSketch('polygon', ring, `${s.name} +${dist}m`, { derived:true, note:`buffer ${dist}m` });
  peShowResult(`Buffer — ${s.name}`, [
    `Distance  ${formatLength(dist)}`,
    `Area      ${formatArea(r.area!=null?r.area:r.areaSqm)}`,
    `Vertices  ${ring.length}`
  ], `Grid-sampled at about ${out.cell.toFixed(1)} m per cell, so the boundary is accurate to roughly that. Fine for planning, not for cadastral work.`);
}


// ── POINT IN POLYGON ── exact. Tests every point sketch AND every saved point feature against the
// selected polygon, since "which of the things I collected fall inside this boundary" is the
// question that actually gets asked in the field.
function pePointInPolygon(){
  const s = peRequireSelected(); if (!s) return;
  if (s.type!=='polygon'){ showToast('Select a polygon sketch first'); return; }
  const insideSketches = plotetchSketches.filter(x=>x.type==='point' && pointInPolygonLL(x.vertices[0].lat, x.vertices[0].lon, s.vertices));
  const insideFeatures = [];
  savedFeatures.forEach(f=>{
    if ((f.geometryType||'point')!=='point') return;
    (f.vertices||[]).forEach(v=>{
      if (pointInPolygonLL(v.lat, v.lon, s.vertices)) { insideFeatures.push(f.name||'(unnamed)'); }
    });
  });
  const totalPts = plotetchSketches.filter(x=>x.type==='point').length;
  const lines = [
    `Sketch points   ${insideSketches.length} / ${totalPts} inside`,
    `Saved features  ${insideFeatures.length} inside`
  ];
  const names = [...insideSketches.map(x=>x.name), ...new Set(insideFeatures)];
  if (names.length) lines.push('', ...names.slice(0,12).map(n=>`  · ${escapeHtml(n)}`));
  if (names.length>12) lines.push(`  …and ${names.length-12} more`);
  peShowResult(`Points in ${s.name}`, lines, 'Exact ray-casting test — no approximation here.');
}


// ── INTERSECT / CLIP ── raster engine again; both are just different predicates over the same
// two polygons, which is exactly why they share one code path.
function peOverlay(kind){
  const a = peSelected();
  if (!a){ showToast('Select polygon A first'); return; }
  if (a.type!=='polygon'){ showToast('Select a polygon sketch first'); return; }
  const others = plotetchSketches.filter(s=>s.type==='polygon' && s.id!==a.id);
  if (!others.length){ showToast('Digitize a second polygon to overlay against'); return; }
  // B is the most recently added other polygon — with two on screen (the common case) that's
  // unambiguous, and the result names both so there's no doubt which way round it ran.
  const b = others[others.length-1];
  const all = a.vertices.concat(b.vertices);
  const proj = peProjector(all);
  const pa = a.vertices.map(proj.fwd), pb = b.vertices.map(proj.fwd);
  const pred = kind==='intersect'
    ? (p => pePointInRingXY(p,pa) && pePointInRingXY(p,pb))
    : (p => pePointInRingXY(p,pa) && !pePointInRingXY(p,pb));
  const xs=all.map(v=>proj.fwd(v).x), ys=all.map(v=>proj.fwd(v).y);
  const bbox = { minX:Math.min(...xs), maxX:Math.max(...xs), minY:Math.min(...ys), maxY:Math.max(...ys) };
  const out = peRasterOp(pred, bbox, proj, Math.max((bbox.maxX-bbox.minX),(bbox.maxY-bbox.minY))*0.02);
  if (!out.rings.length){
    peShowResult(kind==='intersect'?'Intersect':'Clip (A−B)', [
      `A  ${escapeHtml(a.name)}`,
      `B  ${escapeHtml(b.name)}`,
      '',
      kind==='intersect' ? 'No overlap between these polygons.' : 'A is entirely inside B — nothing remains.'
    ]);
    return;
  }
  const ring = out.rings[0];
  const r = polygonAreaAndPerimeterM(ring);
  const area = r.area!=null?r.area:r.areaSqm;
  const ra = polygonAreaAndPerimeterM(a.vertices);
  const aArea = ra.area!=null?ra.area:ra.areaSqm;
  const label = kind==='intersect' ? `${a.name} ∩ ${b.name}` : `${a.name} − ${b.name}`;
  peAddSketch('polygon', ring, label, { derived:true, note:kind });
  peShowResult(kind==='intersect'?'Intersect':'Clip (A−B)', [
    `A         ${escapeHtml(a.name)}`,
    `B         ${escapeHtml(b.name)}`,
    `Result    ${formatArea(area)}`,
    `% of A    ${aArea>0 ? ((area/aArea)*100).toFixed(1) : '—'}%`,
    `Parts     ${out.rings.length}`
  ], `Grid-sampled at about ${out.cell.toFixed(1)} m per cell. Only the largest part was kept as a sketch.`);
}


// ══════════════════════════════════════════════════════════════════════════════════════════
// LAYER MANAGER
// ══════════════════════════════════════════════════════════════════════════════════════════
// Feature types ARE the layers here — inventing a separate grouping would mean two overlapping
// concepts for the same thing. Visibility is a session-level display filter held in memory rather
// than persisted: a hidden layer that stayed hidden across restarts is the classic way to lose
// track of data you still have, and the cost of re-hiding is one tap.
let hiddenLayerKeys = new Set();

function openLayerModal(){
  renderLayerModal();
  document.getElementById('layerModal').classList.add('show');
}

function closeLayerModal(){ document.getElementById('layerModal').classList.remove('show'); }

function layerInventory(){
  const map = new Map();
  savedFeatures.forEach(f=>{
    const info = resolveFeatureType(f);
    const key = info.key;
    if (!map.has(key)) map.set(key, { key, label:info.label, color:featureTypeColor(key), count:0, verts:0 });
    const e = map.get(key);
    e.count++; e.verts += (f.vertices||[]).length;
  });
  return Array.from(map.values()).sort((a,b)=>b.count-a.count);
}

function renderLayerModal(){
  const el = document.getElementById('layerModalList');
  if (!el) return;
  const items = layerInventory();
  if (!items.length){
    el.innerHTML = '<div class="pe-empty">No features captured yet, so there are no layers to manage.</div>';
    return;
  }
  el.innerHTML = items.map(it=>{
    const on = !hiddenLayerKeys.has(it.key);
    return `<div class="lm-row">
      <span class="lm-swatch" style="background:${it.color}"></span>
      <div class="lm-body">
        <div class="lm-name">${escapeHtml(it.label)}</div>
        <div class="lm-meta">${it.count} feature${it.count===1?'':'s'} · ${it.verts} vertices</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" ${on?'checked':''} onchange="toggleLayer('${escapeHtml(it.key)}', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>`;
  }).join('');
}

function toggleLayer(key, visible){
  if (visible) hiddenLayerKeys.delete(key); else hiddenLayerKeys.add(key);
  renderReviewMap();
  updateLayerBtnState();
}

function showAllLayers(){
  hiddenLayerKeys.clear();
  renderLayerModal();
  renderReviewMap();
  updateLayerBtnState();
  showToast('All layers shown');
}

// The map button carries a count when anything is hidden, so a filtered map can never be mistaken
// for an empty one — the single most confusing state a layer control can leave you in.
function updateLayerBtnState(){
  const lbl = document.getElementById('mapLayerToggleLabel');
  if (lbl) lbl.textContent = hiddenLayerKeys.size ? `${hiddenLayerKeys.size} hidden` : 'Layers';
}


// ══════════════════════════════════════════════════════════════════════════════════════════
// GO TO COORDINATE / FEATURE SEARCH
// ══════════════════════════════════════════════════════════════════════════════════════════
function openGotoModal(){
  document.getElementById('gotoCoordInput').value = '';
  document.getElementById('gotoSearchInput').value = '';
  document.getElementById('gotoResults').innerHTML = '';
  document.getElementById('gotoModal').classList.add('show');
  setTimeout(()=>document.getElementById('gotoCoordInput').focus(), 80);
}

function closeGotoModal(){ document.getElementById('gotoModal').classList.remove('show'); }


// Accepts decimal degrees ("-17.82, 31.03") and DMS ("17°49'30.7\"S 31°02'00.6\"E"), because field
// coordinates arrive in whichever of the two the source system happened to use and retyping one
// as the other by hand is exactly where transcription errors come from.
function parseCoordInput(raw){
  const s = String(raw||'').trim();
  if (!s) return null;
  const dec = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (dec){
    const lat = parseFloat(dec[1]), lon = parseFloat(dec[2]);
    if (Math.abs(lat)<=90 && Math.abs(lon)<=180) return { lat, lon };
    return null;
  }
  const dmsRe = /(\d+(?:\.\d+)?)\s*[°d:]\s*(?:(\d+(?:\.\d+)?)\s*['m:]\s*)?(?:(\d+(?:\.\d+)?)\s*["s]?\s*)?([NSEW])/gi;
  const found = [];
  let m;
  while ((m = dmsRe.exec(s)) !== null){
    const deg = parseFloat(m[1]) + (parseFloat(m[2])||0)/60 + (parseFloat(m[3])||0)/3600;
    const hemi = m[4].toUpperCase();
    found.push({ v: (hemi==='S'||hemi==='W') ? -deg : deg, axis: (hemi==='N'||hemi==='S') ? 'lat' : 'lon' });
  }
  if (found.length===2){
    const lat = found.find(f=>f.axis==='lat'), lon = found.find(f=>f.axis==='lon');
    if (lat && lon && Math.abs(lat.v)<=90 && Math.abs(lon.v)<=180) return { lat:lat.v, lon:lon.v };
  }
  return null;
}

function gotoCoordinate(){
  const c = parseCoordInput(document.getElementById('gotoCoordInput').value);
  if (!c){ showToast('Couldn\'t read that coordinate'); return; }
  closeGotoModal();
  // Whichever map the user is actually looking at is the one that should move.
  const onPlotEtch = document.getElementById('view-plotetch').classList.contains('active');
  if (onPlotEtch && peMap){
    peMap.setView([c.lat, c.lon], 18);
    L.circleMarker([c.lat,c.lon],{radius:9,color:'#F59E0B',weight:3,fillOpacity:0}).addTo(peDraftGroup);
  } else {
    switchTab('review');
    setTimeout(()=>{ if (reviewMap) reviewMap.setView([c.lat, c.lon], 18); }, 120);
  }
  showToast(`Moved to ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`);
}

function renderGotoResults(){
  const q = document.getElementById('gotoSearchInput').value.trim().toLowerCase();
  const el = document.getElementById('gotoResults');
  if (!q){ el.innerHTML=''; return; }
  const hits = savedFeatures.filter(f=>
    (f.name||'').toLowerCase().includes(q) || (f.ref||'').toLowerCase().includes(q)
  ).slice(0, 8);
  if (!hits.length){ el.innerHTML = '<div class="pe-empty">No features match that.</div>'; return; }
  el.innerHTML = hits.map(f=>{
    const info = resolveFeatureType(f);
    return `<div class="pe-sketch" onclick="gotoFeature(${JSON.stringify(f.id)})">
      <span class="pe-sketch-chip" style="background:${featureTypeColor(info.key)}"></span>
      <div class="pe-sketch-body">
        <div class="pe-sketch-name">${escapeHtml(f.name||'(unnamed)')}</div>
        <div class="pe-sketch-meta">${escapeHtml(info.label)}${f.ref?' · '+escapeHtml(f.ref):''}</div>
      </div>
    </div>`;
  }).join('');
}

function gotoFeature(id){
  const f = savedFeatures.find(x=>String(x.id)===String(id));
  if (!f) return;
  closeGotoModal();
  const verts = f.vertices||[];
  if (!verts.length){ showToast('That feature has no geometry'); return; }
  switchTab('review');
  setTimeout(()=>{
    if (reviewMap){
      const b = verts.map(v=>[v.lat,v.lon]);
      b.length===1 ? reviewMap.setView(b[0], 18) : reviewMap.fitBounds(b, { padding:[40,40] });
    }
  }, 120);
}


// ══════════════════════════════════════════════════════════════════════════════════════════
// FEATURE INSPECTOR
// ══════════════════════════════════════════════════════════════════════════════════════════
let _inspectId = null;

function openInspect(id){
  const f = savedFeatures.find(x=>String(x.id)===String(id));
  if (!f){ showToast('That feature no longer exists'); return; }
  _inspectId = f.id;
  const info = resolveFeatureType(f);
  const color = featureTypeColor(info.key);
  const verts = f.vertices||[];
  const geo = f.geometryType||'point';

  const stats = [['Geometry', geo.charAt(0).toUpperCase()+geo.slice(1)], ['Vertices', String(verts.length)]];
  if (geo==='line' && verts.length>=2) stats.push(['Length', formatLength(lineLengthM(verts))]);
  if (geo==='polygon' && verts.length>=3){
    const r = polygonAreaAndPerimeterM(verts);
    stats.push(['Area', formatArea(r.area)], ['Perimeter', formatLength(r.perimeter)]);
  }
  const accs = verts.map(v=>v.acc).filter(a=>a!=null && isFinite(a));
  if (accs.length) stats.push(['Best acc', formatLength(Math.min(...accs))]);
  const photoCount = verts.reduce((s,v)=>s+((v.photos||[]).length),0);
  if (photoCount) stats.push(['Photos', String(photoCount)]);

  // The feature type's own declared fields first and in schema order, then anything else present
  // on the record (auto-computed geometry attrs, imported columns) so nothing is silently hidden.
  const ft = getFeatureType(f.featureTypeId);
  const attrs = f.attrs || {};
  const rows = [];
  const seen = new Set();
  if (ft) ft.fields.filter(fl=>fl.scope!=='vertex').forEach(fl=>{
    seen.add(fl.id);
    rows.push([fl.label, formatAttrValue(attrs[fl.id])]);
  });
  Object.keys(attrs).forEach(k=>{ if (!seen.has(k)) rows.push([k, formatAttrValue(attrs[k])]); });

  document.getElementById('inspectBody').innerHTML = `
    <div class="fi-head">
      <span class="fi-chip" style="background:${color}"></span>
      <div style="min-width:0;">
        <div class="fi-title">${escapeHtml(f.name||'(unnamed)')}</div>
        <div class="fi-sub">${escapeHtml(info.label)}${f.ref?' · '+escapeHtml(f.ref):''}${f.assignedTo?' · '+escapeHtml(f.assignedTo):''}</div>
      </div>
    </div>
    <div class="fi-grid">
      ${stats.map(([k,v])=>`<div class="fi-stat"><div class="fi-stat-lbl">${escapeHtml(k)}</div><div class="fi-stat-val">${escapeHtml(v)}</div></div>`).join('')}
    </div>
    ${rows.length ? `<div class="pe-result-title" style="margin-bottom:4px;">Attributes</div>${
      rows.map(([k,v])=>`<div class="fi-attr"><span class="fi-attr-k">${escapeHtml(k)}</span><span class="fi-attr-v">${escapeHtml(v)}</span></div>`).join('')
    }` : ''}
    ${f.notes ? `<div class="pe-result-title" style="margin:14px 0 4px;">Notes</div><div class="help-p">${escapeHtml(f.notes)}</div>` : ''}
    <div class="pe-result" style="margin-top:14px;">
      <div class="pe-result-title">First vertex</div>
      ${verts.length ? `<div class="pe-result-line">${verts[0].lat.toFixed(6)}, ${verts[0].lon.toFixed(6)}</div>` : '<div class="pe-result-line">—</div>'}
      <div class="pe-result-note">Saved ${f.savedAt ? escapeHtml(new Date(f.savedAt).toLocaleString()) : 'unknown'}${f.editedAt ? ` · edited ${escapeHtml(new Date(f.editedAt).toLocaleString())}` : ''}</div>
    </div>`;
  const editBtn = document.getElementById('inspectEditBtn');
  editBtn.onclick = () => { closeInspect(); if (typeof editFeature==='function') editFeature(f.id); };
  document.getElementById('inspectModal').classList.add('show');
}

function closeInspect(){ document.getElementById('inspectModal').classList.remove('show'); _inspectId=null; }

function formatAttrValue(v){
  if (v===null || v===undefined || v==='') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}


// ══════════════════════════════════════════════════════════════════════════════════════════
// HELP & ABOUT
// ══════════════════════════════════════════════════════════════════════════════════════════
function openHelp(){
  const el = document.getElementById('helpVersion');
  if (el){
    let bytes = 0;
    try { bytes = (localStorage.getItem(STORAGE_KEY)||'').length; } catch(e){}
    const kb = bytes ? (bytes/1024).toFixed(0) : '0';
    el.textContent = `PlotEdge · ${projects.length} project${projects.length===1?'':'s'} on this device · about ${kb} KB stored`;
  }
  document.getElementById('helpModal').classList.add('show');
}

function closeHelp(){ document.getElementById('helpModal').classList.remove('show'); }



// ══════════════════════════════════════════════════════════════════════════════════════════
// QUICK ACTIONS REGISTRY
// ══════════════════════════════════════════════════════════════════════════════════════════
// The dashboard grid and the More drawer are now two renderings of one list rather than two
// hand-maintained blocks of markup. That's what makes them customisable at all: "visible" is just
// a set of ids, everything not in it falls through to the drawer automatically, and neither list
// can drift out of sync with the other or accidentally show the same action twice.
const QA_REGISTRY = [
  { id:'featuretypes', label:'Feature Types',   run:()=>showFeatureTypes(),
    icon:'<path d="M12 2 2 7l10 5 10-5z"/><path d="m2 12 10 5 6-3"/><circle cx="18.5" cy="18.5" r="3"/><path d="M18.5 14.4v1.1M18.5 21.5v1.1M14.4 18.5h1.1M21.5 18.5h1.1"/>' },
  { id:'import',       label:'Import',          run:()=>switchTabNav('import'),
    icon:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>' },
  { id:'export',       label:'Export',          run:()=>switchTabNav('export'),
    icon:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' },
  { id:'newproject',   label:'New Project',     run:()=>showNewProject(),
    icon:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>' },
  { id:'plotetch',     label:'PlotEtch',        run:()=>openPlotEtch(),
    icon:'<polygon points="12 3 20 8.5 17.5 18.5 6.5 18.5 4 8.5"/><circle cx="12" cy="3" r="1.6" fill="currentColor"/><circle cx="20" cy="8.5" r="1.6" fill="currentColor"/><circle cx="4" cy="8.5" r="1.6" fill="currentColor"/>' },
  { id:'attrtable',    label:'Attribute Table', run:()=>openAttributeTable(),
    icon:'<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/>' },
  { id:'zonal',        label:'Zonal Stats',     run:()=>runZonalStatsForProject(),
    icon:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
  { id:'layers',       label:'Layers',          run:()=>openLayerModal(),
    icon:'<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>' },
  { id:'goto',         label:'Go To',           run:()=>openGotoModal(),
    icon:'<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
  { id:'media',        label:'Media Gallery',   run:()=>showMediaGallery(),
    icon:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>' },
  { id:'gps',          label:'Connect GPS',     run:()=>toggleExternalGps(),
    icon:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><line x1="12" y1="1.5" x2="12" y2="4.5"/><line x1="12" y1="19.5" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4.5" y2="12"/><line x1="19.5" y1="12" x2="22.5" y2="12"/>' },
  { id:'backup',       label:'Backup All',      run:()=>exportAllProjects(),
    icon:'<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="M23 3H1l4 5h14z"/><line x1="10" y1="12" x2="14" y2="12"/>' },
  { id:'notes',        label:'Quick Notes',     run:()=>openQuickNotesModal(),
    icon:'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>' },
  // Gated by the Settings toggle via available(). PlotLens belongs here rather than as a one-off
  // row on Review: it is the same class of tool as PlotEtch, Media Gallery and Attribute Table —
  // project-scoped, opened occasionally — and putting it in the registry means it inherits the
  // customisable grid, the More drawer and the same tile styling instead of inventing its own.
  { id:'plotlens',     label:'PlotLens',        run:()=>showPlotLens(), available:()=>plotLensEnabled(),
    icon:'<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/>' },
  { id:'help',         label:'Help & About',    run:()=>openHelp(),
    icon:'<circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.9 2.9 0 0 1 5.6 1c0 2-2.8 2.5-2.8 4"/><line x1="12" y1="17.5" x2="12.01" y2="17.5"/>' }
];

const QA_DEFAULT = ['featuretypes','import','export','newproject'];

const QA_MAX = 6;   // three rows of two — past that the grid costs more fold than it saves taps

const QA_MIN = 2;

const QA_KEY = 'plotedge_quickactions';


// An action may declare available() to opt out of the grid, the drawer and the customise sheet at
// once. Actions without one are always available, so this changes nothing for the existing twelve.
function qaAvailable(){ return QA_REGISTRY.filter(a => typeof a.available !== 'function' || a.available()); }

function qaVisibleIds(){
  let ids;
  try { ids = JSON.parse(localStorage.getItem(QA_KEY) || 'null'); } catch(e){ ids = null; }
  const avail = qaAvailable();
  if (!Array.isArray(ids)) return QA_DEFAULT.filter(id => avail.some(a=>a.id===id));
  // Filter against the registry on every read rather than trusting what was stored: a saved id
  // for an action that has since been renamed, removed, or switched off in Settings would
  // otherwise render a blank tile that does nothing when tapped.
  ids = ids.filter(id => avail.some(a=>a.id===id));
  return ids.length ? ids.slice(0, QA_MAX) : QA_DEFAULT.filter(id => avail.some(a=>a.id===id));
}

function qaSetVisibleIds(ids){
  try { localStorage.setItem(QA_KEY, JSON.stringify(ids)); } catch(e){}
}

function qaActionById(id){ return QA_REGISTRY.find(a=>a.id===id); }


function qaTileHtml(action, inDrawer){
  const onclick = inDrawer
    ? `runFromMoreActions(()=>qaRun('${action.id}'))`
    : `qaRun('${action.id}')`;
  return `<button class="qa-tile" onclick="${onclick}">
    <span class="qa-icon-badge"><svg class="qa-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${action.icon}</svg></span>
    <span class="qa-text">${escapeHtml(action.label)}</span>
    <svg class="qa-tile-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
  </button>`;
}

function qaRun(id){
  const a = qaActionById(id);
  if (!a) { showToast('That action is no longer available'); return; }
  try { a.run(); } catch(e){ console.error('Quick action failed:', e); showToast('That action couldn\'t run'); }
}

function renderQuickActions(){
  const visible = qaVisibleIds();
  const grid = document.getElementById('qaGrid');
  if (grid) grid.innerHTML = visible.map(id=>qaTileHtml(qaActionById(id), false)).join('');
  const rest = qaAvailable().filter(a=>!visible.includes(a.id));
  const drawer = document.getElementById('qaDrawerGrid');
  if (drawer) drawer.innerHTML = rest.map(a=>qaTileHtml(a, true)).join('');
  const count = document.getElementById('qaMoreCount');
  if (count) count.textContent = String(rest.length);
}


// ── CUSTOMISE SHEET ──
function openCustomizeQa(){
  renderCustomizeQa();
  document.getElementById('customizeQaModal').classList.add('show');
}

function closeCustomizeQa(){
  document.getElementById('customizeQaModal').classList.remove('show');
  renderQuickActions();
}

function renderCustomizeQa(){
  const visible = qaVisibleIds();
  const max = document.getElementById('qaMaxLabel');
  if (max) max.textContent = String(QA_MAX);
  const el = document.getElementById('qaCustomList');
  if (!el) return;
  // Selected actions listed first and in their grid order, so the list doubles as a preview of
  // what the dashboard will look like.
  // qaAvailable(), not QA_REGISTRY: the customise sheet must not offer a tile the user cannot
  // currently have — picking a switched-off action would save an id that then filters straight
  // back out, so it would silently do nothing.
  const ordered = visible.map(qaActionById).concat(qaAvailable().filter(a=>!visible.includes(a.id)));
  el.innerHTML = ordered.map(a=>{
    const on = visible.includes(a.id);
    const pos = on ? visible.indexOf(a.id)+1 : null;
    return `<div class="lm-row">
      <span class="qa-icon-badge" style="width:24px;height:24px;"><svg class="qa-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${a.icon}</svg></span>
      <div class="lm-body">
        <div class="lm-name">${escapeHtml(a.label)}</div>
        <div class="lm-meta">${on ? `Dashboard · slot ${pos}` : 'In More actions'}</div>
      </div>
      ${on ? `<button class="pe-sketch-x" onclick="qaMove('${a.id}',-1)" aria-label="Move up" ${pos===1?'disabled style="opacity:0.3"':''}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </button>` : ''}
      <label class="toggle-switch">
        <input type="checkbox" ${on?'checked':''} onchange="qaToggle('${a.id}', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>`;
  }).join('');
}

function qaToggle(id, on){
  let visible = qaVisibleIds();
  if (on){
    if (visible.length >= QA_MAX){
      showToast(`The grid holds ${QA_MAX}. Turn one off first.`);
      renderCustomizeQa();   // repaint so the checkbox springs back
      return;
    }
    if (!visible.includes(id)) visible.push(id);
  } else {
    // Never let the grid empty out — an empty Quick actions block looks like a rendering fault
    // rather than a choice, and there'd be no obvious way back to Customise from the dashboard.
    if (visible.length <= QA_MIN){
      showToast(`Keep at least ${QA_MIN} on the dashboard.`);
      renderCustomizeQa();
      return;
    }
    visible = visible.filter(x=>x!==id);
  }
  qaSetVisibleIds(visible);
  renderCustomizeQa();
}

function qaMove(id, dir){
  const visible = qaVisibleIds();
  const i = visible.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= visible.length) return;
  [visible[i], visible[j]] = [visible[j], visible[i]];
  qaSetVisibleIds(visible);
  renderCustomizeQa();
}

function resetQuickActions(){
  qaSetVisibleIds(QA_DEFAULT.slice());
  renderCustomizeQa();
  showToast('Quick actions reset');
}
