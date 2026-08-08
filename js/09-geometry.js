// ═══════════════════════════════════════════════════════════════════════════
// PlotEdge — Manual entry, hold-to-average, shape preview, vertex map, digitizing aids
// ═══════════════════════════════════════════════════════════════════════════
// Part of an ordered set: js/*.js are plain classic scripts loaded in filename
// order by index.html. Order matters — a file can only use top-level names
// declared in itself or in a file loaded before it. Renumbering or reordering
// them will break the app; `npm test` checks this.


// ══ MANUAL COORDINATE ENTRY ══ — fallback for when GPS can't settle indoors (see
// updateIndoorGpsBanner). Adds a vertex straight from typed lat/lon, bypassing GPS entirely.
function openManualCoordEntry(){
  document.getElementById('manualLat').value='';
  document.getElementById('manualLon').value='';
  document.getElementById('manualCoordModal').classList.add('show');
}

function closeManualCoordEntry(){
  document.getElementById('manualCoordModal').classList.remove('show');
}

function submitManualCoordEntry(){
  const lat=parseFloat(document.getElementById('manualLat').value);
  const lon=parseFloat(document.getElementById('manualLon').value);
  if (isNaN(lat) || lat<-90 || lat>90){ showToast('Enter a valid latitude (-90 to 90)'); return; }
  if (isNaN(lon) || lon<-180 || lon>180){ showToast('Enter a valid longitude (-180 to 180)'); return; }
  closeManualCoordEntry();
  commitVertex(lat, lon, null, null, false, true);
}


function doCapture(coords, weak){
  const {latitude:lat,longitude:lon,altitude:alt,accuracy:acc}=coords;
  commitVertex(lat, lon, alt, acc, weak);
}


function attemptCapture(){
  if(!currentPos) return;
  const now = Date.now();
  if (now - lastCaptureAt < CAPTURE_DEBOUNCE_MS) return; // guards against an accidental double-tap logging two near-identical vertices
  const acc = currentPos.coords.accuracy;
  doCapture(currentPos.coords, acc > CAPTURE_ACCURACY_WARN_M);
}


// ══ HOLD-TO-AVERAGE ══
function startHoldAveraging(){
  holdActive = true;
  holdSamples = currentPos ? [currentPos.coords] : [];
  holdStartedAt = Date.now();
  const btn = document.getElementById('captureBtn');
  btn.classList.add('averaging');
  updateHoldLabel();
  clearInterval(holdSampleInterval);
  holdSampleInterval = setInterval(()=>{
    if (currentPos) holdSamples.push(currentPos.coords);
    updateHoldLabel();
    if (Date.now() - holdStartedAt >= HOLD_MAX_MS) finishHoldAveraging();
  }, HOLD_SAMPLE_MS);
}

function updateHoldLabel(){
  const label = document.getElementById('captureBtnLabel');
  const secs = Math.min(HOLD_MAX_MS, Date.now()-holdStartedAt)/1000;
  label.textContent = `Averaging… ${holdSamples.length} fix${holdSamples.length===1?'':'es'} (${secs.toFixed(1)}s)`;
}

function finishHoldAveraging(){
  clearInterval(holdSampleInterval); holdSampleInterval = null;
  const btn = document.getElementById('captureBtn');
  btn.classList.remove('averaging');
  holdActive = false;
  const sel=document.getElementById('featureTypeSelect');
  const ft=sel && !sel.disabled ? getFeatureType(sel.value) : null;
  if (ft) updateGeometryUI(ft); // restores the normal button label
  if (!holdSamples.length){ return; }
  const n = holdSamples.length;
  const lat = holdSamples.reduce((s,c)=>s+c.latitude,0)/n;
  const lon = holdSamples.reduce((s,c)=>s+c.longitude,0)/n;
  const alts = holdSamples.filter(c=>c.altitude!=null).map(c=>c.altitude);
  const alt = alts.length ? alts.reduce((s,a)=>s+a,0)/alts.length : null;
  const acc = holdSamples.reduce((s,c)=>s+c.accuracy,0)/n;
  commitVertex(lat, lon, alt, acc, acc > CAPTURE_ACCURACY_WARN_M);
  if (acc <= CAPTURE_ACCURACY_WARN_M) showToast(`Averaged ${n} fix${n===1?'':'es'} (±${acc.toFixed(1)} m)`);
}

function cancelHoldAveraging(){
  clearInterval(holdSampleInterval); holdSampleInterval = null;
  holdActive = false; holdSamples = [];
  const btn = document.getElementById('captureBtn');
  btn.classList.remove('averaging');
  const sel=document.getElementById('featureTypeSelect');
  const ft=sel && !sel.disabled ? getFeatureType(sel.value) : null;
  if (ft) updateGeometryUI(ft);
}

function onCaptureBtnDown(){
  const btn = document.getElementById('captureBtn');
  if (btn.disabled) return;
  enterCollectDataEntry();
  clearTimeout(holdTimer);
  holdTimer = setTimeout(startHoldAveraging, HOLD_THRESHOLD_MS);
}

function onCaptureBtnUp(){
  clearTimeout(holdTimer);
  if (holdActive) finishHoldAveraging();
  else attemptCapture();
}

function onCaptureBtnCancel(){
  clearTimeout(holdTimer);
  if (holdActive) cancelHoldAveraging();
}


function deletePoint(i) {
  const [removed] = currentVertices.splice(i,1);
  const prevOpenVertexIndex = openVertexIndex;
  if (openVertexIndex===i) openVertexIndex = currentVertices.length ? Math.max(0,i-1) : null;
  else if (openVertexIndex!==null && openVertexIndex>i) openVertexIndex--;
  persist({ destructive: true }); renderPoints(); renderVertexEditor();
  const sel=document.getElementById('featureTypeSelect');
  const ft=sel && !sel.disabled ? getFeatureType(sel.value) : null;
  if (ft) updateGeometryUI(ft);
  showUndoToast('Vertex deleted', () => {
    currentVertices.splice(i,0,removed);
    openVertexIndex = prevOpenVertexIndex;
    persist(); renderPoints(); renderVertexEditor();
    if (ft) updateGeometryUI(ft);
    showToast('Vertex restored');
  });
}

function editVertex(i) { openVertexIndex = i; renderPoints(); renderVertexEditor(); }

function renderPoints() {
  const el=document.getElementById('pointsList');
  const n=currentVertices.length;
  document.getElementById('ptCount').textContent=n?`(${n})`:'';
  if(!n){el.innerHTML='<div class="empty-box"><strong>No vertices yet</strong>Start GPS above and tap Capture</div>';updateShapePreview();return;}
  const geo = getCurrentGeometryType();
  // Start/End only mean something once there's an actual line/path — a lone vertex on a
  // line/polygon feature is neither yet, so this only kicks in from the 2nd vertex on.
  const showRoles = (geo==='line' || geo==='polygon') && n>=2;
  // Reordering only makes sense once there's more than one vertex, and only for line/polygon —
  // a "point" feature's multiple captures are independent re-shoots, not a sequence.
  const canReorder = (geo==='line' || geo==='polygon') && n>=2;
  el.innerHTML=currentVertices.map((p,i)=>{
    const cls=p.acc==null?'manual':p.acc<=5?'good':p.acc<=15?'ok':'poor';
    const nPh=(p.photos||[]).length;
    const phBadge=nPh?`<span class="pt-photos-badge">📷${nPh}</span>`:'';
    const roleBadge = !showRoles ? '' : i===0 ? '<span class="pt-role-badge pt-role-start">Start</span>' : i===n-1 ? '<span class="pt-role-badge pt-role-end">End</span>' : '';
    const moveGroup = !canReorder ? '' : `<div class="pt-move-group">
        <button class="pt-move" onclick="moveVertex(${i},-1)" ${i===0?'disabled':''} title="Move earlier in the sequence" aria-label="Move vertex earlier in the sequence">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="pt-move" onclick="moveVertex(${i},1)" ${i===n-1?'disabled':''} title="Move later in the sequence" aria-label="Move vertex later in the sequence">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>`;
    return `<div class="point-item ${i===openVertexIndex?'open':''}" data-idx="${i}">
      ${moveGroup}
      <div class="pt-num">${i+1}</div>
      <div class="pt-coords">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
      ${roleBadge}
      ${phBadge}
      <div class="pt-acc ${cls}">${p.acc==null?'manual':'±'+p.acc.toFixed(1)+'m'}</div>
      <button class="pt-edit" onclick="editVertex(${i})" title="Edit this vertex's details" aria-label="Edit vertex details">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="pt-del" onclick="deletePoint(${i})">×</button>
    </div>`;
  }).join('');
  updateShapePreview();
}

// Swaps a vertex with its neighbor — the simplest safe way to fix a mis-ordered capture (e.g. a
// polygon corner shot out of sequence) without needing full drag-and-drop reordering.
function moveVertex(i, dir){
  const j = i+dir;
  if (j<0 || j>=currentVertices.length) return;
  [currentVertices[i], currentVertices[j]] = [currentVertices[j], currentVertices[i]];
  if (openVertexIndex===i) openVertexIndex=j;
  else if (openVertexIndex===j) openVertexIndex=i;
  persist(); renderPoints(); renderVertexEditor();
}

// ══ INLINE SHAPE PREVIEW ══
// Pure-SVG plot of the captured vertices' relative lat/lon — no map tiles or network needed, so
// it works exactly as well offline as on. Only meaningful for line/polygon once there's a shape
// forming; a lone point or a "point" feature's independent re-shoots don't need it.
function updateShapePreview(){
  const svg = document.getElementById('shapePreview');
  const geo = getCurrentGeometryType();
  const n = currentVertices.length;
  if (!svg) return;
  // The satellite-correction toggle can appear a little earlier than the SVG plot itself (useful
  // from the very first vertex, since "this pin landed on the wrong side of the road" is just as
  // real a problem with one point as with a whole line) — SVG needs 2+ points to draw anything.
  const mapToggle = document.getElementById('vertexMapToggleBtn');
  if (mapToggle) mapToggle.style.display = (geo==='line' || geo==='polygon') && n>=1 ? '' : 'none';
  if (vertexMapVisible) renderVertexMap();
  if ((geo!=='line' && geo!=='polygon') || n<2){ svg.classList.remove('show'); svg.innerHTML=''; return; }
  const W=300,H=130,PAD=14;
  const lats = currentVertices.map(v=>v.lat), lons = currentVertices.map(v=>v.lon);
  const minLat=Math.min(...lats), maxLat=Math.max(...lats), minLon=Math.min(...lons), maxLon=Math.max(...lons);
  const spanLat = Math.max(maxLat-minLat, 1e-9), spanLon = Math.max(maxLon-minLon, 1e-9);
  // Longitude degrees compress with latitude — correct so the preview isn't stretched/squashed
  const lonScale = Math.cos((minLat+maxLat)/2 * Math.PI/180) || 1;
  const spanX = spanLon*lonScale, spanY = spanLat;
  const scale = Math.min((W-PAD*2)/Math.max(spanX,1e-9), (H-PAD*2)/Math.max(spanY,1e-9));
  const cx = (v)=> W/2 + (v.lon-(minLon+maxLon)/2)*lonScale*scale;
  const cy = (v)=> H/2 - (v.lat-(minLat+maxLat)/2)*scale; // screen Y is inverted vs latitude
  const pts = currentVertices.map(v=>`${cx(v).toFixed(1)},${cy(v).toFixed(1)}`).join(' ');
  const fillPoly = geo==='polygon' ? `<polygon class="sp-fill" points="${pts}"></polygon>` : '';
  const line = geo==='polygon'
    ? `<polygon class="sp-line" points="${pts}"></polygon>`
    : `<polyline class="sp-line" points="${pts}"></polyline>`;
  const dots = currentVertices.map((v,i)=>`<circle class="sp-vertex ${i===openVertexIndex?'sp-open':''}" cx="${cx(v).toFixed(1)}" cy="${cy(v).toFixed(1)}" r="${i===openVertexIndex?4.5:3}"></circle>`).join('');
  svg.innerHTML = fillPoly + line + dots;
  svg.classList.add('show');
}


// ══ VERTEX SATELLITE MAP ══ — real imagery so a mis-placed vertex is obvious against the actual
// ground (a driveway, a fence line, a building corner), with two ways to fix it: drag an existing
// pin to where it should be, or tap empty map to digitize a vertex that never got a GPS fix at
// all. Shares the same free, no-API-key Esri World Imagery layer as the Review tab's satellite
// basemap (see ensureReviewMap above) rather than the Google Maps tile API, which needs a billed
// API key/account — outside this app's "no external accounts to manage" design elsewhere (e.g.
// the OSM Nominatim geocoding, the Netlify Blobs photo upload).
let vertexMap = null, vertexMapMarkersLayer = null, vertexMapLine = null, vertexMapVisible = false;

function toggleVertexMap(){
  vertexMapVisible = !vertexMapVisible;
  const wrap = document.getElementById('vertexMapWrap');
  const btn = document.getElementById('vertexMapToggleBtn');
  const label = document.getElementById('vertexMapToggleLabel');
  wrap.classList.toggle('show', vertexMapVisible);
  btn.classList.toggle('on', vertexMapVisible);
  label.textContent = vertexMapVisible ? 'Hide satellite map' : 'Adjust on satellite map';
  if (vertexMapVisible) {
    ensureVertexMap();
    renderVertexMap();
    // Leaflet sizes itself off the container's dimensions at creation time — if that happened
    // while the wrap was display:none (0×0), tiles render into a collapsed map. Kicking a resize
    // right after it becomes visible fixes that without needing to eagerly create the map (and
    // fetch tiles) before the user has actually asked to see it.
    setTimeout(()=>{ if (vertexMap) vertexMap.invalidateSize(); }, 60);
  }
}

function ensureVertexMap(){
  if (vertexMap) return vertexMap;
  const el = document.getElementById('vertexMap');
  if (!el || typeof L === 'undefined') return null;
  vertexMap = L.map(el, { zoomControl:true, attributionControl:false });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 21,
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
  }).addTo(vertexMap);
  vertexMapMarkersLayer = L.layerGroup().addTo(vertexMap);
  // Tapping open ground digitizes a new vertex there — same "manual" path already used by the
  // typed-coordinates fallback (see submitManualCoordEntry), so it shows up identically in the
  // vertex list (no accuracy value, marked as a manual entry) whether it was typed or tapped.
  // snapLatLng() first, so a tap near an existing vertex lands exactly on it (see below).
  vertexMap.on('click', (e) => {
    const p = snapLatLng(e.latlng);
    commitVertex(p.lat, p.lng, null, null, false, true);
    if (p.snapped) showToast('Snapped to existing vertex');
  });
  vertexMap.setView([0,0], 2);
  return vertexMap;
}

// Rebuilds the pins + connecting line from currentVertices. Called whenever vertices change while
// the map is open (capture, delete, reorder, drag-correct) so the map never shows a stale shape.
// Re-fitting the view on every redraw would fight a user mid-drag or mid-pan, so it only fits
// bounds the first time a shape appears on the map (fromEmpty), not on every subsequent update.
// ══════════════ DIGITIZING AIDS ══════════════
// Two things the tap-to-place/drag-to-move map above was missing for real survey work.
//
// 1. SNAPPING. Adjacent parcels share a boundary; a fence line ends where the next one starts.
//    Placed by eye at zoom 20, two "identical" corners end up 20-30cm apart, which becomes a
//    sliver polygon or a gap the moment the data reaches QGIS. Snapping makes a shared corner
//    genuinely identical rather than merely close.
// 2. LIVE MEASUREMENT. Whether the shape being walked is the right size is the question a crew
//    actually has on site, and it was only answerable after saving the feature.
let digiSnapOn = true;

const DIGI_SNAP_PX = 18; // tap tolerance in screen pixels, so it scales naturally with zoom


function toggleDigiSnap(){
  digiSnapOn = !digiSnapOn;
  const btn = document.getElementById('digiSnapBtn');
  const label = document.getElementById('digiSnapLabel');
  if (btn){ btn.classList.toggle('on', digiSnapOn); btn.setAttribute('aria-pressed', digiSnapOn ? 'true':'false'); }
  if (label) label.textContent = digiSnapOn ? 'Snap on' : 'Snap off';
  showToast(digiSnapOn ? 'Snapping on' : 'Snapping off');
  renderVertexMap();
}


// Candidate targets: every vertex of every saved feature in this project, plus the other vertices
// of the shape being drawn (so a polygon can be closed exactly onto its own first corner).
// skipIndex excludes the vertex currently being dragged, which would otherwise snap to itself.
function digiSnapTargets(skipIndex){
  const out = [];
  savedFeatures.forEach(f=>{
    (f.vertices||[]).forEach(v=>{
      if (v.lat!=null && v.lon!=null) out.push({ lat:v.lat, lon:v.lon, name:f.name });
    });
  });
  currentVertices.forEach((v,i)=>{
    if (i === skipIndex) return;
    if (v.lat!=null && v.lon!=null) out.push({ lat:v.lat, lon:v.lon, name:null });
  });
  return out;
}

// Tolerance is measured in screen pixels via the map's own projection, not in metres: at zoom 15
// a 0.5m tolerance is invisible, and at zoom 21 a 5m one would swallow every nearby corner. A
// fixed pixel radius means "near enough to have meant it" at any zoom.
function snapLatLng(latlng, skipIndex){
  const plain = { lat: latlng.lat, lng: latlng.lng, snapped: false };
  if (!digiSnapOn || !vertexMap) return plain;
  const origin = vertexMap.latLngToContainerPoint(latlng);
  let best = null, bestDist = DIGI_SNAP_PX;
  digiSnapTargets(skipIndex).forEach(t=>{
    const p = vertexMap.latLngToContainerPoint([t.lat, t.lon]);
    const d = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (d < bestDist){ bestDist = d; best = t; }
  });
  return best ? { lat:best.lat, lng:best.lon, snapped:true } : plain;
}


// Removes the most recently added vertex — the digitizing equivalent of a mis-tap correction.
// Deliberately routed through the same delete path as the vertex list so the undo toast, persist
// and re-render behave identically however the vertex was removed.
function undoLastVertex(){
  if (!currentVertices.length){ showToast('No vertices to undo'); return; }
  if (typeof deletePoint === 'function') { deletePoint(currentVertices.length - 1); return; }
  currentVertices.pop();
  if (openVertexIndex !== null && openVertexIndex >= currentVertices.length) openVertexIndex = null;
  persist(); renderPoints(); updateShapePreview(); renderVertexEditor();
}


// Running length / area, recomputed from currentVertices on every redraw. Reuses the same
// haversine and shoelace helpers that write geom_length_m / geom_area_sqm onto the saved feature,
// so what the crew reads here is exactly what lands in the export — not a second, near-enough
// estimate that quietly disagrees with it.
function renderDigiReadout(){
  const el = document.getElementById('digiReadout');
  if (!el) return;
  const geo = getCurrentGeometryType();
  const n = currentVertices.length;
  if (n < 2 || (geo !== 'line' && geo !== 'polygon')){ el.style.display = 'none'; return; }
  let html = '';
  if (geo === 'polygon'){
    if (n < 3){ el.style.display = 'none'; return; }
    const { area, perimeter } = polygonAreaAndPerimeterM(currentVertices);
    html = `<span class="digi-main">${formatArea(area)}</span><span class="digi-sub">${formatLength(perimeter)} perimeter · ${n} vertices</span>`;
  } else {
    let len = 0;
    for (let i = 1; i < n; i++){
      len += haversineM(currentVertices[i-1].lat, currentVertices[i-1].lon, currentVertices[i].lat, currentVertices[i].lon);
    }
    html = `<span class="digi-main">${formatLength(len)}</span><span class="digi-sub">${n} vertices</span>`;
  }
  el.innerHTML = html;
  el.style.display = 'block';
}


function renderVertexMap(){
  if (!vertexMap || !vertexMapMarkersLayer) return;
  const hadNone = vertexMapMarkersLayer.getLayers().length === 0;
  vertexMapMarkersLayer.clearLayers();
  if (vertexMapLine) { vertexMap.removeLayer(vertexMapLine); vertexMapLine = null; }
  const n = currentVertices.length;
  renderDigiReadout();
  if (!n) { vertexMap.setView([0,0], 2); return; }
  const geo = getCurrentGeometryType();
  const latlngs = currentVertices.map(v => [v.lat, v.lon]);
  if (n >= 2 && (geo==='line' || geo==='polygon')) {
    vertexMapLine = (geo==='polygon' ? L.polygon(latlngs, { color: cssVar('--orange'), weight:2, fillOpacity:0.14 })
                                      : L.polyline(latlngs, { color: cssVar('--orange'), weight:2 })).addTo(vertexMap);
  }
  // Faint ghosts of nearby saved vertices — without them, snapping is invisible until it fires
  // and the operator has no idea a shared corner is even available to snap to. Capped and
  // non-interactive so a dense project can't turn the map into a wall of dots or steal taps.
  if (digiSnapOn){
    const bounds = vertexMap.getBounds();
    let drawn = 0;
    savedFeatures.forEach(f=>{
      (f.vertices||[]).forEach(v=>{
        if (drawn >= 150 || v.lat==null || v.lon==null) return;
        if (!bounds.contains([v.lat, v.lon])) return;
        L.circleMarker([v.lat, v.lon], {
          radius:4, color:cssVar('--accent-primary'), weight:1.5, opacity:0.55,
          fillColor:cssVar('--accent-primary'), fillOpacity:0.22, interactive:false
        }).addTo(vertexMapMarkersLayer);
        drawn++;
      });
    });
  }
  currentVertices.forEach((v, i) => {
    const isOpen = i === openVertexIndex;
    const icon = L.divIcon({
      className: '',
      html: `<div class="vmap-pin${isOpen ? ' vmap-pin-open' : ''}"><span>${i+1}</span></div>`,
      iconSize: isOpen ? [30,30] : [26,26],
      iconAnchor: isOpen ? [15,29] : [13,25]
    });
    const marker = L.marker([v.lat, v.lon], { icon, draggable:true }).addTo(vertexMapMarkersLayer);
    // This is the actual position-correction path: dragging a pin writes straight back into
    // currentVertices, same array the vertex list / SVG preview / export all read from — no
    // separate "map version" of the geometry to keep in sync.
    marker.on('dragend', () => {
      const pos = snapLatLng(marker.getLatLng(), i);
      if (pos.snapped) marker.setLatLng([pos.lat, pos.lng]);
      currentVertices[i].lat = pos.lat;
      currentVertices[i].lon = pos.lng;
      currentVertices[i].manual = true; // no longer the raw GPS fix, flag it same as a typed entry
      persist(); renderPoints(); updateShapePreview();
      if (openVertexIndex === i) renderVertexEditor();
      showToast(`Vertex ${i+1} moved`);
    });
    marker.on('click', () => { openVertexIndex = i; renderVertexEditor(); renderVertexMap(); });
  });
  if (hadNone) {
    if (n === 1) vertexMap.setView(latlngs[0], 19);
    else vertexMap.fitBounds(L.latLngBounds(latlngs), { padding:[28,28], maxZoom:20 });
  }
}
