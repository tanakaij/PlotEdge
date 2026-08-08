// ═══════════════════════════════════════════════════════════════════════════
// PlotEdge — Export: GeoJSON, CSV, GeoPackage, FlatGeobuf, Parquet, Excel, PDF, backup
// ═══════════════════════════════════════════════════════════════════════════
// Part of an ordered set: js/*.js are plain classic scripts loaded in filename
// order by index.html. Order matters — a file can only use top-level names
// declared in itself or in a file loaded before it. Renumbering or reordering
// them will break the app; `npm test` checks this.


// ══ EXPORT ══
function ts(){return new Date().toISOString().slice(0,16).replace('T','_').replace(':','-');}

function dl(content,name,mime){
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([content],{type:mime})),download:name});
  a.click(); URL.revokeObjectURL(a.href);
}


function exportGeoJSON(){
  if(!savedFeatures.length){showToast('No features to export');return;}
  const byType={}; const typeLabels={};
  savedFeatures.forEach(f=>{
    const info=resolveFeatureType(f);
    const key=f.featureTypeId||f.layer||'unclassified';
    typeLabels[key]=info.label;
    (byType[key]=byType[key]||[]).push(f);
  });
  const types=Object.keys(byType); const stamp=ts(); let i=0;
  const next=()=>{
    if(i>=types.length){
      document.getElementById('exportStatus').textContent=`✓ ${types.length} GeoJSON file${types.length>1?'s':''} downloaded`;
      showToast(`${types.length} GeoJSON file${types.length>1?'s':''} downloaded`); markProjectExported(); return;
    }
    const key=types[i++]; const label=typeLabels[key];
    const fc={type:'FeatureCollection',name:label,features:byType[key].flatMap(f=>geoJSONFeaturesFor(f,label))};
    dl(JSON.stringify(fc,null,2),`${label.replace(/\s+/g,'_')}_${stamp}.geojson`,'application/json');
    setTimeout(next,650);
  };
  next();
  if(types.length>1) document.getElementById('exportStatus').textContent=`Downloading ${types.length} files…`;
}


// EXPORT CHOICE — documented here since it's the key modelling decision for this rewrite:
// Point features may have several captured vertices (multi-angle re-shoots of the "same" spot).
// We export those as one GeoJSON Point Feature *per capture* rather than a single MultiPoint,
// because MultiPoint geometries share one flat `properties` object across all their points —
// that would silently drop each capture's own attrs/photos/angle-labels. One-Feature-per-capture
// keeps every vertex's data queryable as its own row/feature in QGIS/ArcGIS attribute tables.
// Line/polygon features are inherently a single connected shape, so they export as one Feature
// with a LineString/Polygon geometry; polygon rings are auto-closed per the GeoJSON spec by
// repeating the first vertex's coordinates as the ring's last coordinate. Per-vertex attrs/photo
// counts for lines/polygons are preserved losslessly in a nested `vertices` property array.
function geoJSONFeaturesFor(f, label){
  const verts=f.vertices||[];
  const geo=f.geometryType||'point';
  const baseProps={feature_name:f.name,reference_id:f.ref||'',feature_type:label,assigned_to:f.assignedTo||'',...flattenAttrs(f.attrs),feature_saved_at:f.savedAt,notes:f.notes||''};
  const coordsOf=v=>(v.alt!==null&&v.alt!==undefined)?[+v.lon.toFixed(7),+v.lat.toFixed(7),+v.alt.toFixed(2)]:[+v.lon.toFixed(7),+v.lat.toFixed(7)];

  // Embeds each photo's actual image data (base64 data: URI), not just a count/filename, so the
  // photos travel *inside* the GeoJSON/GPKG/FlatGeobuf file itself — no separate photos folder
  // needed to see what was captured. Semicolon-joined per vertex (same convention as the existing
  // photo_cloud_urls field) so it stays a flat string column rather than nested JSON, which keeps
  // it valid as a plain TEXT column once it reaches GeoPackage. This does make files much larger;
  // the original "Download Photos" / zip-export routes are unaffected and still give plain .jpg
  // files for anyone who just wants the images without the geodata wrapper.
  if (geo==='point'){
    return verts.map((v,vi)=>({
      type:'Feature',
      geometry:{type:'Point',coordinates:coordsOf(v)},
      properties:{...baseProps,...flattenAttrs(v.attrs),vertex_index:vi+1,total_vertices:verts.length,accuracy_m:(v.acc!=null?+v.acc.toFixed(2):null),captured_at:v.time,photo_count:(v.photos||[]).length,photo_angle_labels:(v.photos||[]).map(p=>p.angleLabel).filter(Boolean).join(';'),photo_cloud_urls:(v.photos||[]).map(p=>p.cloudUrl).filter(Boolean).join(';'),photos_data_uris:(v.photos||[]).map(p=>p.dataUrl).filter(Boolean).join(';')}
    }));
  }
  const ring=verts.map(coordsOf);
  const coordinates = geo==='polygon' ? [ ring.length ? [...ring, ring[0]] : ring ] : ring; // polygon: close ring; line: as-is
  return [{
    type:'Feature',
    geometry:{type: geo==='polygon'?'Polygon':'LineString', coordinates},
    properties:{...baseProps,vertex_count:verts.length,total_photo_count:verts.reduce((s,v)=>s+(v.photos||[]).length,0),
      vertices: verts.map((v,vi)=>({index:vi+1,accuracy_m:(v.acc!=null?+v.acc.toFixed(2):null),captured_at:v.time,attrs:flattenAttrs(v.attrs),photo_count:(v.photos||[]).length,cloud_urls:(v.photos||[]).map(p=>p.cloudUrl).filter(Boolean).join(';'),photos_data_uris:(v.photos||[]).map(p=>p.dataUrl).filter(Boolean).join(';')}))}
  }];
}


// Multi-select arrays become semicolon-joined strings, booleans become yes/no, for flat export formats
function flattenAttrs(attrs){
  const out={};
  Object.entries(attrs||{}).forEach(([k,v])=>{
    out[k]=Array.isArray(v)?v.join(';'):(v===true?'yes':v===false?'no':(v==null?'':v));
  });
  return out;
}


// Groups savedFeatures into one GeoJSON FeatureCollection per feature type — the same grouping
// exportGeoJSON() uses — so GeoPackage/FlatGeobuf/PostGIS can share one code path instead of
// re-deriving layers three different ways.
function collectFeatureCollectionsByType(){
  const byType={}; const typeLabels={};
  savedFeatures.forEach(f=>{
    const info=resolveFeatureType(f);
    const key=f.featureTypeId||f.layer||'unclassified';
    typeLabels[key]=info.label;
    (byType[key]=byType[key]||[]).push(f);
  });
  return Object.keys(byType).map(key=>({
    key, label:typeLabels[key],
    fc:{type:'FeatureCollection', name:typeLabels[key], features:byType[key].flatMap(f=>geoJSONFeaturesFor(f,typeLabels[key]))}
  }));
}


// Turns a feature-type label into a safe SQL/table identifier for GeoPackage layers and the
// PostGIS command block (lowercase, alnum+underscore only, can't start with a digit or collide
// with the reserved gpkg_ prefix used by GeoPackage's own metadata tables).
function sanitizeTableName(label){
  let t=(label||'layer').toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'');
  if(!t) t='layer';
  if(/^[0-9]/.test(t)) t='t_'+t;
  if(t.startsWith('gpkg_')) t='layer_'+t;
  return t.slice(0,60);
}


// Pure CSV builder — reads the current global savedFeatures/resolveFeatureType, returns the CSV
// text with no side effects (no download, no toast). Used by both the single-project exportCSV()
// button and exportAllProjects()'s per-project CSV inside the zip.
function buildCSVString(){
  const featAttrKeys=[]; const seenF=new Set();
  const vtxAttrKeys=[]; const seenV=new Set();
  savedFeatures.forEach(f=>{
    Object.keys(f.attrs||{}).forEach(k=>{if(!seenF.has(k)){seenF.add(k);featAttrKeys.push(k);}});
    (f.vertices||[]).forEach(v=>Object.keys(v.attrs||{}).forEach(k=>{if(!seenV.has(k)){seenV.add(k);vtxAttrKeys.push(k);}}));
  });
  // feature_id is PlotEdge's own stable internal id (assigned once at capture time and never
  // re-editable) — added specifically so rows can be grouped back into the correct line/polygon
  // by an ID that can't collide, rather than by feature_name/reference_id, which are just text
  // the user can edit or accidentally duplicate. Use this as the "group by" field in QGIS's
  // Points to Path tool (or any similar join), ordered by vertex_index, to rebuild geometry
  // exactly as captured — this is also what PlotEdge's own CSV re-import now groups by (see
  // importCSVData below), so a round trip through this export never risks merging two features
  // that happen to share a name.
  const heads=['feature_id','reference_id','feature_name','feature_type','geometry_type','assigned_to',...featAttrKeys,...vtxAttrKeys.map(k=>'vtx_'+k),'vertex_index','total_vertices','latitude','longitude','altitude_m','accuracy_m','captured_at','feature_saved_at','notes','photo_count','photo_names','photo_cloud_urls','photo_data_uris'];
  const rows=savedFeatures.flatMap(f=>{
    const info=resolveFeatureType(f);
    const flat=flattenAttrs(f.attrs);
    const fileBase=(f.featureTypeId?info.label:f.layer)||'feature';
    const verts=f.vertices||[];
    return verts.map((v,i)=>{
      const vflat=flattenAttrs(v.attrs);
      const photoNames=(v.photos||[]).map((p,pi)=>`${fileBase}_${f.name.replace(/\s+/g,'_')}_v${i+1}_photo${pi+1}${p.angleLabel?('_'+p.angleLabel.replace(/\s+/g,'_')):''}.jpg`).join(';');
      const photoCloudUrls=(v.photos||[]).map(p=>p.cloudUrl).filter(Boolean).join(';');
      // Photos embedded directly as base64 data: URIs, same convention as GeoJSON/GPKG's
      // photos_data_uris — makes this CSV self-contained but considerably larger per row with photos.
      const photoDataUris=(v.photos||[]).map(p=>p.dataUrl).filter(Boolean).join(';');
      return [
        q(f.id),q(f.ref||''),q(f.name),q(info.label),q(f.geometryType||'point'),q(f.assignedTo||''),
        ...featAttrKeys.map(k=>q(flat[k]||'')),
        ...vtxAttrKeys.map(k=>q(vflat[k]||'')),
        i+1,verts.length,v.lat.toFixed(7),v.lon.toFixed(7),
        (v.alt!==null&&v.alt!==undefined)?v.alt.toFixed(2):'',(v.acc!=null?v.acc.toFixed(2):''),
        q(v.time),q(f.savedAt),q(f.notes||''),(v.photos||[]).length,q(photoNames),q(photoCloudUrls),q(photoDataUris)
      ];
    });
  });
  return [heads.join(','),...rows.map(r=>r.join(','))].join('\r\n');
}

function exportCSV(){
  if(!savedFeatures.length){showToast('No features to export');return;}
  const csv=buildCSVString();
  const total=savedFeatures.reduce((s,f)=>s+(f.vertices||[]).length,0);
  dl(csv,`plotedge_${ts()}.csv`,'text/csv');
  document.getElementById('exportStatus').textContent=`✓ CSV (${savedFeatures.length} features, ${total} rows)`;
  showToast(`CSV downloaded (${total} rows)`);
  markProjectExported();
}


function exportPhotos(){
  const all=savedFeatures.flatMap(f=>{
    const info=resolveFeatureType(f);
    const base=(f.featureTypeId?info.label:f.layer)||'feature';
    return (f.vertices||[]).flatMap((v,vi)=>(v.photos||[]).map((p,pi)=>({dataUrl:p.dataUrl,name:`${base.replace(/\s+/g,'_')}_${f.name.replace(/\s+/g,'_')}_v${vi+1}_photo${pi+1}${p.angleLabel?('_'+p.angleLabel.replace(/\s+/g,'_')):''}.jpg`})));
  });
  if(!all.length){showToast('No photos to export');return;}
  let i=0;
  const next=()=>{
    if(i>=all.length){document.getElementById('exportStatus').textContent=`✓ ${all.length} photo${all.length>1?'s':''} downloaded`;showToast(`${all.length} photo${all.length>1?'s':''} downloaded`);markProjectExported();return;}
    const ph=all[i++]; const a=document.createElement('a'); a.href=ph.dataUrl; a.download=ph.name; a.click();
    setTimeout(next,700);
  };
  next();
  if(all.length>1) document.getElementById('exportStatus').textContent=`Downloading ${all.length} photos…`;
}


function q(v){const s=String(v??'');return(s.includes(',')||s.includes('"')||s.includes('\n'))?'"'+s.replace(/"/g,'""')+'"':s;}


// ══ EXPORT ALL PROJECTS (zipped backup) ══
// Lives on the Projects landing screen rather than inside a single project's Export tab, since it
// backs up every project's data in one go — GeoJSON (grouped by feature type) + a flat CSV + all
// photos, one subfolder per project. Reuses the same per-project export helpers
// (collectFeatureCollectionsByType/buildCSVString/resolveFeatureType) by temporarily pointing the
// shared globals at each project's stored data in turn, since those helpers were written to read
// off the "currently open project" globals rather than taking a project id as a parameter.
function exportAllProjects(){
  if (!projects.length){ showToast('No projects to export'); return; }
  if (typeof JSZip === 'undefined'){
    showToast('Zip export needs a connection to load once. Try again online, or export projects individually from inside each one.');
    return;
  }
  // "Export all" now lives only in Data → Backup & Restore (#exportAllBtnPm); the Welcome screen
  // no longer carries one, since with zero projects it could only ever export an empty file. The
  // legacy id stays in this lookup and .filter(Boolean) drops whichever ids aren't in the DOM, so
  // the busy state still binds to whichever button actually exists.
  const btns = ['exportAllBtn','exportAllBtnPm'].map(i=>document.getElementById(i)).filter(Boolean);
  const setBusy = on => btns.forEach(b=>{ b.disabled = on; });
  setBusy(true);
  showToast('Zipping all projects…');

  const zip = new JSZip();
  const stamp = ts();
  const saved = { featureTypes, savedFeatures, currentVertices, activeProjectId };
  let projectsWithData = 0;
  const exportedProjectIds = [];

  projects.forEach(p=>{
    const d = projectData[p.id] || { savedFeatures:[], currentVertices:[], featureTypes:[] };
    if (!(d.savedFeatures||[]).length) return;
    projectsWithData++;
    exportedProjectIds.push(p.id);
    featureTypes = d.featureTypes || [];
    savedFeatures = d.savedFeatures || [];
    const folderName = sanitizeFileSegment(p.name || 'Project');
    const folder = zip.folder(folderName);

    collectFeatureCollectionsByType().forEach(({label, fc})=>{
      folder.file(`${label.replace(/\s+/g,'_')}.geojson`, JSON.stringify(fc, null, 2));
    });
    folder.file(`${folderName}_all_features.csv`, buildCSVString());

    const photosFolder = folder.folder('photos');
    savedFeatures.forEach(f=>{
      const info = resolveFeatureType(f);
      const base = (f.featureTypeId ? info.label : f.layer) || 'feature';
      (f.vertices||[]).forEach((v,vi)=>{
        (v.photos||[]).forEach((ph,pi)=>{
          const commaIdx = ph.dataUrl.indexOf(',');
          const b64 = commaIdx>=0 ? ph.dataUrl.slice(commaIdx+1) : ph.dataUrl;
          const name = `${base.replace(/\s+/g,'_')}_${f.name.replace(/\s+/g,'_')}_v${vi+1}_photo${pi+1}${ph.angleLabel?('_'+ph.angleLabel.replace(/\s+/g,'_')):''}.jpg`;
          photosFolder.file(name, b64, {base64:true});
        });
      });
    });
  });

  featureTypes = saved.featureTypes;
  savedFeatures = saved.savedFeatures;
  currentVertices = saved.currentVertices;
  activeProjectId = saved.activeProjectId;

  if (!projectsWithData){
    setBusy(false);
    showToast('No captured features in any project yet');
    return;
  }

  zip.generateAsync({type:'blob'}).then(blob=>{
    const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob), download:`PlotEdge_AllProjects_${stamp}.zip`});
    a.click(); URL.revokeObjectURL(a.href);
    showToast(`✓ ${projectsWithData} project${projectsWithData>1?'s':''} zipped`);
    const stamp2 = new Date().toISOString();
    exportedProjectIds.forEach(id=>{ const p2=projects.find(x=>x.id===id); if (p2) p2.lastExportedAt = stamp2; });
    persistStore(); refreshExportMeta();
    setBusy(false);
  }).catch(err=>{
    console.warn('Zip generation failed', err);
    showToast('Zip export failed. Try again, or export projects individually.');
    setBusy(false);
  });
}


// ══ GEOPACKAGE + FLATGEOBUF (lazy-loaded from CDN — kept out of the base bundle since a WASM
// SQLite build and a binary-format serializer both add real weight to what is otherwise a
// single-file, fully offline app) ══
function loadScript(src){
  return new Promise((resolve,reject)=>{
    if(document.querySelector(`script[data-src="${src}"]`)){ resolve(); return; }
    const s=document.createElement('script');
    s.src=src; s.dataset.src=src;
    s.onload=()=>resolve(); s.onerror=()=>reject(new Error('Failed to load '+src));
    document.head.appendChild(s);
  });
}

// ══ RASTER REFERENCE LAYER (GeoTIFF, lazy-loaded from CDN — same reasoning as GeoPackage/FlatGeobuf
// below: parsing raster imagery is a real dependency to carry around, so it only loads the first
// time someone actually taps "Raster". Kept as a pure client-side overlay: no server, no re-tiling
// pipeline — the file is parsed and rendered entirely in the browser, which is what keeps this
// feature compatible with the app's offline-first, single-file architecture. It is intentionally
// display + sampling only — GeoTIFFs are never bundled back into GeoJSON/GPKG/FGB exports, since
// those are vector formats and re-encoding raster into them wouldn't be a meaningful export. ══
let _georasterPromise=null;

function ensureGeoraster(){
  if(_georasterPromise) return _georasterPromise;
  // proj4 is loaded alongside georaster (not just when needed) because georaster-layer-for-leaflet
  // looks for a *global* window.proj4 at render time to reproject non-4326 rasters on the fly —
  // if it isn't present yet when the layer starts drawing tiles, a UTM GeoTIFF renders in the
  // wrong place with no error. Cheap enough (~40KB) to just always bring along with georaster.
  _georasterPromise=Promise.all([
    loadScript('https://cdn.jsdelivr.net/npm/georaster@1.6.0/dist/georaster.browser.bundle.min.js'),
    ensureProj4()
  ]).then(()=>loadScript('https://cdn.jsdelivr.net/npm/georaster-layer-for-leaflet@3.10.0/dist/georaster-layer-for-leaflet.min.js'));
  return _georasterPromise;
}

// Resolves a georaster's detected EPSG code (georaster.projection) to a proj4 definition string
// for OUR OWN sampling math (pixel lookups for sampleRasterAt/zonal stats). This is separate from
// display: georaster-layer-for-leaflet reprojects for rendering by itself via global proj4, but
// sampling indexes g.xmin/ymin/ymax/pixelWidth/pixelHeight directly, which are in the raster's
// native units — so a lat/lon query has to be converted into those same units first, or every
// sample from a UTM (or other projected) GeoTIFF would silently read the wrong pixel.
function resolveRasterSrs(epsg){
  if(!epsg || epsg===4326) return { ok:true, kind:'wgs84' };
  if(epsg===3857) return { ok:true, kind:'webmercator', def:WEBMERCATOR_DEF };
  const utm = utmProj4Def(Number(epsg));
  if(utm) return { ok:true, kind:'utm', def:utm };
  return { ok:false, kind:'unsupported', epsg };
}

// Converts a WGS84 {lat,lon} into the raster's native coordinate units so it can be compared
// against g.xmin/xmax/ymin/ymax for pixel indexing. Returns the same {lat,lon} unchanged for
// already-WGS84 rasters (the common case) so this is a no-op cost when no reprojection applies.
function toRasterUnits(lat, lon, crs){
  if(!crs || crs.kind==='wgs84') return {lat,lon};
  const [x,y] = proj4('WGS84', crs.def, [lon,lat]);
  return { lat:y, lon:x };
}

// Rough safety cap: fully-decoded raster pixel data lives in memory as one JS number per band per
// pixel, which balloons fast on mobile. 150MB is generous for a source file but still leaves the
// decoded array within what a phone browser tab can usually hold without crashing the tab.
const RASTER_MAX_BYTES = 150 * 1024 * 1024;

let rasterLayer = null;     // the active GeoRasterLayer, if any

let rasterGeoraster = null; // the parsed georaster object (kept for pixel sampling)

let rasterCrs = null;       // resolved CRS info for sampling math (see resolveRasterSrs)

let rasterFileNameStr = '';


function onRasterToggleClick(){
  if (rasterLayer){
    // Already have one loaded — clicking again just toggles the control panel rather than
    // re-opening a file picker, so opacity/remove stay reachable without re-uploading.
    const panel = document.getElementById('mapRasterPanel');
    panel.classList.toggle('show');
    return;
  }
  document.getElementById('rasterFileInput').click();
}


async function onRasterFileSelected(event){
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // allow re-selecting the same file later
  if (!file) return;
  if (!/\.tiff?$/i.test(file.name)){
    showToast('Please choose a .tif or .tiff file.');
    return;
  }
  if (file.size > RASTER_MAX_BYTES){
    showToast(`That file is ${(file.size/1024/1024).toFixed(0)}MB — larger than this app can safely decode on a phone. Try a downsampled/clipped export instead.`);
    return;
  }
  const map = ensureReviewMap();
  if (!map){ showToast('Map isn\'t ready yet — try again in a moment.'); return; }
  showToast('Loading raster…');
  try{
    await ensureGeoraster();
    const buf = await file.arrayBuffer();
    const georaster = await parseGeoraster(buf);
    removeRasterLayer(); // clear any previous one first
    rasterGeoraster = georaster;
    rasterCrs = resolveRasterSrs(georaster.projection);
    rasterLayer = new GeoRasterLayer({
      georaster,
      opacity: (document.getElementById('rasterOpacitySlider').value||80)/100,
      resolution: 128 // pixels-per-tile the layer renders at; keeps redraw snappy while panning/zooming
    });
    rasterLayer.addTo(map);
    // Bring the vector features back above the new raster so points/lines/polygons stay visible
    // and clickable rather than getting buried under the reference imagery. reviewMapLayerGroup is
    // a plain L.layerGroup (not a FeatureGroup), so bringToFront isn't available on it directly —
    // iterate its child layers instead.
    if (reviewMapLayerGroup && reviewMapLayerGroup.eachLayer){
      reviewMapLayerGroup.eachLayer(l => { if (l.bringToFront) l.bringToFront(); });
    }
    map.fitBounds(rasterLayer.getBounds());
    rasterFileNameStr = file.name;
    document.getElementById('rasterFileName').textContent = file.name;
    document.getElementById('mapRasterPanel').classList.add('show');
    document.getElementById('mapRasterToggle').classList.add('active');
    if (rasterCrs.ok){
      showToast('Raster loaded.');
    } else {
      // Display still works (georaster-layer-for-leaflet reprojects for rendering on its own via
      // global proj4), but our own sampling math above can't index pixels correctly without
      // knowing the projection, so pixel-value sampling and zonal stats are disabled for this file.
      showToast(`Raster loaded (displaying only — EPSG:${rasterCrs.epsg} isn't a projection this app can sample pixel values from).`);
    }
  }catch(err){
    console.error(err);
    showToast('Couldn\'t read that GeoTIFF. It may use a compression this app can\'t decode.');
  }
}


function onRasterOpacityChange(val){
  if (rasterLayer) rasterLayer.setOpacity(val/100);
}


function removeRasterLayer(){
  if (rasterLayer && reviewMap){
    reviewMap.removeLayer(rasterLayer);
  }
  rasterLayer = null;
  rasterGeoraster = null;
  rasterCrs = null;
  rasterFileNameStr = '';
  const panel = document.getElementById('mapRasterPanel');
  if (panel) panel.classList.remove('show');
  const btn = document.getElementById('mapRasterToggle');
  if (btn) btn.classList.remove('active');
}


// Samples the raster's first band under a lat/lon, for auto-filling a feature attribute (e.g.
// elevation from a DEM) at capture time. Returns null if there's no raster loaded or the point
// falls outside its extent — callers should treat that as "nothing to fill in", not an error.
function sampleRasterAt(lat, lon){
  if (!rasterGeoraster || !rasterCrs || !rasterCrs.ok) return null;
  const g = rasterGeoraster;
  const p = toRasterUnits(lat, lon, rasterCrs);
  if (p.lat < g.ymin || p.lat > g.ymax || p.lon < g.xmin || p.lon > g.xmax) return null;
  const col = Math.floor((p.lon - g.xmin) / g.pixelWidth);
  const row = Math.floor((g.ymax - p.lat) / g.pixelHeight);
  if (row < 0 || row >= g.height || col < 0 || col >= g.width) return null;
  try{
    const val = g.values[0][row][col];
    if (val === g.noDataValue) return null;
    return val;
  }catch(e){ return null; }
}


// Standard ray-casting point-in-polygon test on a simple ring of [lon,lat]-ish {lat,lon} vertices.
// Good enough for the polygons this app captures (single ring, no holes).
function pointInPolygonLL(lat, lon, vertices){
  let inside = false;
  for (let i=0, j=vertices.length-1; i<vertices.length; j=i++){
    const vi=vertices[i], vj=vertices[j];
    const intersect = ((vi.lat > lat) !== (vj.lat > lat)) &&
      (lon < (vj.lon - vi.lon) * (lat - vi.lat) / (vj.lat - vi.lat) + vi.lon);
    if (intersect) inside = !inside;
  }
  return inside;
}


// Zonal stats: for a polygon's vertex ring, walks every raster pixel inside its bounding box and
// keeps the ones that actually fall inside the ring (point-in-polygon per pixel centroid) —
// straightforward rather than fast, but PlotEdge's polygons are field-captured shapes (dozens of
// vertices, not thousands), so this stays well within what a phone can chew through in real time.
function computeZonalStats(vertices){
  if (!rasterGeoraster || !rasterCrs) return null;
  if (!rasterCrs.ok) return { unsupportedCrs:true };
  const g = rasterGeoraster;
  // Reproject the polygon ring once into the raster's native units, so every pixel-centroid
  // check below compares like-for-like coordinates — avoids re-running proj4 per pixel, which
  // would make this noticeably slower on anything but a tiny polygon.
  const ring = vertices.map(v => toRasterUnits(v.lat, v.lon, rasterCrs));
  const lats = ring.map(v=>v.lat), lons = ring.map(v=>v.lon);
  const minLat = Math.max(Math.min(...lats), g.ymin), maxLat = Math.min(Math.max(...lats), g.ymax);
  const minLon = Math.max(Math.min(...lons), g.xmin), maxLon = Math.min(Math.max(...lons), g.xmax);
  if (minLat >= maxLat || minLon >= maxLon) return null; // polygon doesn't overlap the raster at all

  const colStart = Math.max(0, Math.floor((minLon - g.xmin) / g.pixelWidth));
  const colEnd   = Math.min(g.width-1, Math.ceil((maxLon - g.xmin) / g.pixelWidth));
  const rowStart = Math.max(0, Math.floor((g.ymax - maxLat) / g.pixelHeight));
  const rowEnd   = Math.min(g.height-1, Math.ceil((g.ymax - minLat) / g.pixelHeight));

  // Safety cap: a huge polygon over a fine-resolution raster could imply millions of pixel
  // checks. Rather than freezing the tab, bail out with a clear reason so the user knows to try
  // a coarser raster or a smaller area instead of wondering why nothing happened.
  const pixelBudget = (colEnd-colStart+1) * (rowEnd-rowStart+1);
  if (pixelBudget > 2_000_000) return { tooLarge:true };

  let sum=0, count=0, min=Infinity, max=-Infinity;
  for (let row=rowStart; row<=rowEnd; row++){
    const lat = g.ymax - (row+0.5)*g.pixelHeight;
    for (let col=colStart; col<=colEnd; col++){
      const lon = g.xmin + (col+0.5)*g.pixelWidth;
      if (!pointInPolygonLL(lat, lon, ring)) continue;
      const val = g.values[0][row][col];
      if (val === g.noDataValue) continue;
      sum += val; count++;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  if (!count) return { count:0 };
  return { count, mean:+(sum/count).toFixed(3), min:+min.toFixed(3), max:+max.toFixed(3) };
}


// Runs zonal stats for every polygon feature in the active project against the currently loaded
// raster, and writes the results into each feature's attrs (raster_mean/min/max/px_count) — same
// "just another attribute" approach as the per-vertex raster_sample, so results show up in the
// review list and every export format without any schema/UI changes elsewhere.
function runZonalStatsForProject(){
  if (!rasterGeoraster){ showToast('Load a raster first.'); return; }
  if (rasterCrs && !rasterCrs.ok){ showToast(`Can't run zonal stats — EPSG:${rasterCrs.epsg} isn't a projection this app can sample.`); return; }
  const polys = savedFeatures.filter(f => f.geometryType==='polygon' && f.vertices && f.vertices.length>=3);
  if (!polys.length){ showToast('No polygon features in this project to analyze.'); return; }
  let updated=0, outOfBounds=0, tooLarge=0;
  polys.forEach(f=>{
    const stats = computeZonalStats(f.vertices);
    if (!stats){ outOfBounds++; return; }
    if (stats.tooLarge || stats.unsupportedCrs){ tooLarge++; return; }
    if (!stats.count){ outOfBounds++; return; }
    f.attrs = f.attrs || {};
    f.attrs.raster_mean = stats.mean;
    f.attrs.raster_min = stats.min;
    f.attrs.raster_max = stats.max;
    f.attrs.raster_px_count = stats.count;
    updated++;
  });
  if (updated){ persist(); renderFeatures(); renderReviewMap(); }
  let msg = `Zonal stats added to ${updated} polygon${updated===1?'':'s'}.`;
  if (outOfBounds) msg += ` ${outOfBounds} outside raster extent.`;
  if (tooLarge) msg += ` ${tooLarge} skipped (too large for this raster's resolution).`;
  showToast(msg);
}


let _sqlJsPromise=null;

function ensureSqlJs(){
  if(_sqlJsPromise) return _sqlJsPromise;
  _sqlJsPromise=loadScript('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js')
    .then(()=>initSqlJs({locateFile:file=>`https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`}));
  return _sqlJsPromise;
}

let _fgbPromise=null;

function ensureFlatgeobuf(){
  if(_fgbPromise) return _fgbPromise;
  _fgbPromise=loadScript('https://cdn.jsdelivr.net/npm/flatgeobuf@3.35.0/dist/flatgeobuf-geojson.min.js');
  return _fgbPromise;
}

// hyparquet-writer is published ESM-only (no UMD bundle), so it's loaded via dynamic import()
// rather than loadScript()'s classic <script> tag — jsdelivr's /+esm endpoint bundles whatever
// npm package you ask it for into a single importable ES module regardless of the package's own
// internal file layout, so this works the same way loadScript() does for the UMD engines above:
// fetched once, cached in this promise for the rest of the session.
let _hyparquetPromise=null;

function ensureHyparquetWriter(){
  if(_hyparquetPromise) return _hyparquetPromise;
  _hyparquetPromise=import('https://cdn.jsdelivr.net/npm/hyparquet-writer@0.15/+esm');
  return _hyparquetPromise;
}


// Minimal little-endian WKB writer — just enough of the spec for Point/LineString/Polygon,
// with an optional Z ordinate, to feed GeoPackage's geometry BLOB column.
function u32le(n){const b=new ArrayBuffer(4);new DataView(b).setUint32(0,n,true);return new Uint8Array(b);}

function concatBytes(arrs){const total=arrs.reduce((s,a)=>s+a.length,0);const out=new Uint8Array(total);let o=0;arrs.forEach(a=>{out.set(a,o);o+=a.length;});return out;}

function wkbHeader(baseType,hasZ){const b=new ArrayBuffer(5);const dv=new DataView(b);dv.setUint8(0,1);dv.setUint32(1,hasZ?baseType+1000:baseType,true);return new Uint8Array(b);}

function coordsBytes(coords,hasZ){const dim=hasZ?3:2;const b=new ArrayBuffer(coords.length*dim*8);const dv=new DataView(b);let o=0;coords.forEach(c=>{dv.setFloat64(o,c[0],true);o+=8;dv.setFloat64(o,c[1],true);o+=8;if(hasZ){dv.setFloat64(o,c.length>2?c[2]:0,true);o+=8;}});return new Uint8Array(b);}

function wkbPoint(c,hasZ){return concatBytes([wkbHeader(1,hasZ),coordsBytes([c],hasZ)]);}

function wkbLineString(coords,hasZ){return concatBytes([wkbHeader(2,hasZ),u32le(coords.length),coordsBytes(coords,hasZ)]);}

function wkbPolygon(rings,hasZ){const parts=[wkbHeader(3,hasZ),u32le(rings.length)];rings.forEach(r=>{parts.push(u32le(r.length));parts.push(coordsBytes(r,hasZ));});return concatBytes(parts);}

function geometryToWKB(geom,hasZ){
  if(geom.type==='Point') return wkbPoint(geom.coordinates,hasZ);
  if(geom.type==='LineString') return wkbLineString(geom.coordinates,hasZ);
  return wkbPolygon(geom.coordinates,hasZ);
}

function geomCoordHasZ(geom){
  const c=geom.type==='Point'?geom.coordinates:geom.type==='LineString'?geom.coordinates[0]:(geom.coordinates[0]||[])[0];
  return Array.isArray(c)&&c.length>2;
}

function flattenGeomCoords(geom){
  if(geom.type==='Point') return [geom.coordinates];
  if(geom.type==='LineString') return geom.coordinates;
  return geom.coordinates.flat();
}

// GeoPackage Binary header wrapping a WKB blob: 'GP' magic, version 0, flags (little-endian,
// no envelope, not empty — the envelope is optional per spec so skipping it keeps this simple
// without breaking validity), then the srs_id, then the raw WKB bytes.
function gpbBlob(srsId,wkbBytes){
  const head=new Uint8Array(8);
  head[0]=0x47;head[1]=0x50;head[2]=0;head[3]=0x01;
  new DataView(head.buffer).setInt32(4,srsId,true);
  return concatBytes([head,wkbBytes]);
}


async function exportGeoPackage(){
  if(!savedFeatures.length){showToast('No features to export');return;}
  const btn=document.getElementById('exportFormatBtn'); const txt=document.getElementById('exportFormatBtnText');
  btn.disabled=true; txt.textContent='Loading engine…';
  document.getElementById('exportStatus').textContent='Loading GeoPackage engine…';
  try{
    const SQL=await ensureSqlJs();
    txt.textContent='Building GeoPackage…';
    document.getElementById('exportStatus').textContent='Building GeoPackage…';
    const groups=collectFeatureCollectionsByType().filter(g=>g.fc.features.length);
    const db=new SQL.Database();
    db.run(`CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);`);
    db.run(`INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined cartesian SRS',-1,'NONE',-1,'undefined',NULL),('Undefined geographic SRS',0,'NONE',0,'undefined',NULL),('WGS 84',4326,'EPSG',4326,'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',NULL);`);
    db.run(`CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));`);
    db.run(`CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name,column_name), CONSTRAINT uk_gc_table_name UNIQUE (table_name));`);

    // Total feature count across all layers, used for a single running progress readout below —
    // simpler for the user to track than a separate percentage per layer.
    const totalFeats = groups.reduce((n,g)=>n+g.fc.features.length,0);
    let doneFeats = 0;
    const PROGRESS_CHUNK = 200; // insert this many rows, then yield a frame so the status text
                                 // actually repaints and the tab doesn't look frozen on big exports

    for (const g of groups){
      const feats=g.fc.features;
      const tableName=sanitizeTableName(g.label);
      const geomTypeGpkg=feats[0].geometry.type.toUpperCase();
      const hasZ=feats.some(f=>geomCoordHasZ(f.geometry));
      const propKeys=[]; const seen=new Set();
      feats.forEach(f=>Object.keys(f.properties||{}).forEach(k=>{
        if(k==='vertices') return; // nested per-vertex array on lines/polygons — stored separately as JSON
        if(!seen.has(k)){seen.add(k);propKeys.push(k);}
      }));
      const hasVertices=feats.some(f=>f.properties&&f.properties.vertices);
      const cols=['fid INTEGER PRIMARY KEY AUTOINCREMENT','geom BLOB',...propKeys.map(k=>`"${k}" TEXT`)];
      if(hasVertices) cols.push('vertices_json TEXT');
      db.run(`CREATE TABLE "${tableName}" (${cols.join(', ')});`);

      const insertCols=['geom',...propKeys,...(hasVertices?['vertices_json']:[])];
      const stmt=db.prepare(`INSERT INTO "${tableName}" (${insertCols.map(c=>`"${c}"`).join(',')}) VALUES (${insertCols.map(()=>'?').join(',')})`);
      let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
      for (let fi=0; fi<feats.length; fi++){
        const f=feats[fi];
        const wkb=geometryToWKB(f.geometry,hasZ);
        const vals=[gpbBlob(4326,wkb),...propKeys.map(k=>{const v=f.properties[k];return v==null?null:String(v);}),...(hasVertices?[JSON.stringify(f.properties.vertices||[])]:[])];
        stmt.run(vals);
        flattenGeomCoords(f.geometry).forEach(c=>{minx=Math.min(minx,c[0]);maxx=Math.max(maxx,c[0]);miny=Math.min(miny,c[1]);maxy=Math.max(maxy,c[1]);});
        doneFeats++;
        if (doneFeats % PROGRESS_CHUNK === 0 && totalFeats > PROGRESS_CHUNK){
          document.getElementById('exportStatus').textContent=`Building GeoPackage… ${doneFeats}/${totalFeats} features`;
          await new Promise(r=>setTimeout(r,0)); // yield one frame so the status text actually paints
        }
      }
      stmt.free();

      db.run(`INSERT INTO gpkg_contents (table_name,data_type,identifier,min_x,min_y,max_x,max_y,srs_id) VALUES (?,'features',?,?,?,?,?,4326)`,[tableName,g.label,minx,miny,maxx,maxy]);
      db.run(`INSERT INTO gpkg_geometry_columns (table_name,column_name,geometry_type_name,srs_id,z,m) VALUES (?,'geom',?,4326,?,0)`,[tableName,geomTypeGpkg,hasZ?1:0]);
    }

    const bytes=db.export();
    db.close();
    dl(bytes,`plotedge_${ts()}.gpkg`,'application/geopackage+sqlite3');
    document.getElementById('exportStatus').textContent=`✓ GeoPackage (${groups.length} layer${groups.length>1?'s':''})`;
    showToast('GeoPackage downloaded');
  }catch(err){
    console.error(err);
    document.getElementById('exportStatus').textContent='GeoPackage export failed';
    showToast('GeoPackage export failed. Check console.');
  }finally{
    btn.disabled=false; updateExportFormatUI();
  }
}


async function exportFlatGeobuf(){
  if(!savedFeatures.length){showToast('No features to export');return;}
  const btn=document.getElementById('exportFormatBtn'); const txt=document.getElementById('exportFormatBtnText');
  btn.disabled=true; txt.textContent='Loading engine…';
  document.getElementById('exportStatus').textContent='Loading FlatGeobuf engine…';
  try{
    await ensureFlatgeobuf();
    txt.textContent='Building FlatGeobuf…';
    const groups=collectFeatureCollectionsByType().filter(g=>g.fc.features.length);
    const stamp=ts(); let i=0;
    const next=()=>{
      if(i>=groups.length){
        document.getElementById('exportStatus').textContent=`✓ ${groups.length} FlatGeobuf file${groups.length>1?'s':''} downloaded`;
        showToast(`${groups.length} FlatGeobuf file${groups.length>1?'s':''} downloaded`);
        btn.disabled=false; updateExportFormatUI();
        return;
      }
      const g=groups[i++];
      const bytes=flatgeobuf.geojson.serialize(g.fc);
      dl(bytes,`${g.label.replace(/\s+/g,'_')}_${stamp}.fgb`,'application/octet-stream');
      if(groups.length>1) document.getElementById('exportStatus').textContent=`Downloading FlatGeobuf files… ${i}/${groups.length}`;
      setTimeout(next,650);
    };
    next();
  }catch(err){
    console.error(err);
    document.getElementById('exportStatus').textContent='FlatGeobuf export failed';
    showToast('FlatGeobuf export failed. Check console.');
    btn.disabled=false; updateExportFormatUI();
  }
}


// ══ GEOPARQUET (.parquet) ══ — one column-oriented .parquet file per feature type/layer, same
// per-layer grouping as GeoJSON/FlatGeobuf/GeoPackage above. Geometry is encoded as WKB (reusing
// the same wkb* writer functions GeoPackage's export already uses) in a GEOMETRY-logical-typed
// column, plus a GeoParquet-spec "geo" key/value metadata blob so QGIS, ArcGIS, DuckDB, and
// GeoPandas all recognize it as proper GeoParquet rather than just "a parquet file with a binary
// column". Uses hyparquet-writer — a small, dependency-free JS parquet writer (no WASM/Arrow
// needed) — loaded from CDN on first use, same lazy-load pattern as the other export engines.
async function exportGeoParquet(){
  if(!savedFeatures.length){showToast('No features to export');return;}
  const btn=document.getElementById('exportFormatBtn'); const txt=document.getElementById('exportFormatBtnText');
  btn.disabled=true; txt.textContent='Loading engine…';
  document.getElementById('exportStatus').textContent='Loading GeoParquet engine…';
  try{
    const {parquetWriteBuffer}=await ensureHyparquetWriter();
    txt.textContent='Building GeoParquet…';
    const groups=collectFeatureCollectionsByType().filter(g=>g.fc.features.length);
    const stamp=ts(); let i=0;
    const next=()=>{
      if(i>=groups.length){
        document.getElementById('exportStatus').textContent=`✓ ${groups.length} GeoParquet file${groups.length>1?'s':''} downloaded`;
        showToast(`${groups.length} GeoParquet file${groups.length>1?'s':''} downloaded`);
        markProjectExported();
        btn.disabled=false; updateExportFormatUI();
        return;
      }
      const g=groups[i++];
      const feats=g.fc.features;
      const hasZ=feats.some(f=>geomCoordHasZ(f.geometry));
      const geomTypes=[...new Set(feats.map(f=>f.geometry.type))];
      // bbox in the same pass as the WKB encoding, same corner-tracking approach GeoPackage's
      // export uses, needed for the GeoParquet "geo" metadata's per-column bbox.
      let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
      const wkbData=feats.map(f=>{
        flattenGeomCoords(f.geometry).forEach(c=>{minx=Math.min(minx,c[0]);maxx=Math.max(maxx,c[0]);miny=Math.min(miny,c[1]);maxy=Math.max(maxy,c[1]);});
        return geometryToWKB(f.geometry,hasZ);
      });
      // Attribute columns — every property GeoJSON/GeoPackage already carry for this layer, minus
      // the nested `vertices` array (lines/polygons only) which parquet's flat column model can't
      // hold directly — stored as its own JSON-text column instead, same call GeoPackage makes.
      const propKeys=[]; const seen=new Set();
      feats.forEach(f=>Object.keys(f.properties||{}).forEach(k=>{
        if(k==='vertices') return;
        if(!seen.has(k)){seen.add(k);propKeys.push(k);}
      }));
      const hasVertices=feats.some(f=>f.properties&&f.properties.vertices);
      const columnData=[
        {name:'geometry',data:wkbData,type:'GEOMETRY'},
        ...propKeys.map(k=>({name:k,data:feats.map(f=>{const v=f.properties[k];return v==null?'':String(v);}),type:'STRING'})),
      ];
      if(hasVertices) columnData.push({name:'vertices_json',data:feats.map(f=>JSON.stringify(f.properties.vertices||[])),type:'STRING'});

      // GeoParquet 1.1.0 file metadata — the "geo" key is the part every GeoParquet-aware reader
      // actually looks for; CRS is omitted deliberately since coordinates here are plain lon/lat
      // degrees, which is the spec's own default (OGC:CRS84) when no crs is given.
      const geoMeta={
        version:'1.1.0',
        primary_column:'geometry',
        columns:{ geometry:{ encoding:'WKB', geometry_types:geomTypes, bbox:[minx,miny,maxx,maxy] } }
      };
      const buf=parquetWriteBuffer({ columnData, kvMetadata:[{key:'geo',value:JSON.stringify(geoMeta)}] });
      dl(buf,`${g.label.replace(/\s+/g,'_')}_${stamp}.parquet`,'application/octet-stream');
      if(groups.length>1) document.getElementById('exportStatus').textContent=`Downloading GeoParquet files… ${i}/${groups.length}`;
      setTimeout(next,650);
    };
    next();
  }catch(err){
    console.error(err);
    document.getElementById('exportStatus').textContent='GeoParquet export failed';
    showToast('GeoParquet export failed. Check console.');
    btn.disabled=false; updateExportFormatUI();
  }
}



// ══ EXCEL (.xlsx) — lazy-loaded SheetJS, same on-demand-CDN pattern as sql.js/FlatGeobuf above ══
let _xlsxPromise=null;

function ensureXlsx(){
  if(_xlsxPromise) return _xlsxPromise;
  _xlsxPromise=loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  return _xlsxPromise;
}

// Minimal RFC4126-style CSV line parser (handles quoted fields, escaped "" quotes, and commas
// inside quotes) — used only to turn buildCSVString()'s output into rows/cells for the sheet, so
// the Excel export can never drift out of sync with the CSV export; both read the same columns.
function parseCsvLine(line){
  const out=[]; let cur=''; let inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(inQ){
      if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else inQ=false; }
      else cur+=c;
    } else {
      if(c==='"') inQ=true;
      else if(c===','){ out.push(cur); cur=''; }
      else cur+=c;
    }
  }
  out.push(cur);
  return out;
}

// Free/community SheetJS can't embed a *viewable* image inside a cell (that's a paid-tier
// feature) — so, same as the CSV export, the photo_data_uris column here carries each photo's
// base64 data as text rather than a rendered thumbnail. Anyone who wants actual openable image
// files should use "Download Photos", or one of the embedded-photo formats above (GeoJSON/
// GPKG/FlatGeobuf), which do carry real image data QGIS/ArcGIS can extract.
async function exportExcel(){
  if(!savedFeatures.length){showToast('No features to export');return;}
  const btn=document.getElementById('exportFormatBtn'); const txt=document.getElementById('exportFormatBtnText');
  btn.disabled=true; txt.textContent='Loading engine…';
  document.getElementById('exportStatus').textContent='Loading Excel engine…';
  try{
    await ensureXlsx();
    txt.textContent='Building Excel…';
    // Excel has a hard 32,767-character-per-cell limit. photo_data_uris carries each photo as a
    // full base64 string, which routinely blows past that on any feature with a photo attached —
    // XLSX.write() throws on an oversized cell, which is why this export was failing outright.
    // Photos aren't viewable in a free-tier xlsx cell anyway (see note above), so swap any
    // oversized cell for a short pointer instead of the raw data.
    const XLSX_CELL_LIMIT=32767;
    const rows=buildCSVString().split('\r\n').map(parseCsvLine).map(row=>row.map(cell=>
      cell && cell.length>XLSX_CELL_LIMIT ? '[too large for Excel — use "Download Photos" or GeoJSON/GPKG/FlatGeobuf]' : cell
    ));
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb,ws,'Features');
    const bytes=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    dl(bytes,`plotedge_${ts()}.xlsx`,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    document.getElementById('exportStatus').textContent=`✓ Excel workbook (${savedFeatures.length} features)`;
    showToast('Excel workbook downloaded');
    markProjectExported();
  }catch(err){
    console.error(err);
    document.getElementById('exportStatus').textContent='Excel export failed';
    showToast('Excel export failed. Check console.');
  }finally{
    btn.disabled=false; updateExportFormatUI();
  }
}


// ══ PDF (.pdf) — tabular report, lazy-loaded jsPDF + autotable, same on-demand-CDN pattern as
// the other heavier export engines above. ══
let _jspdfPromise=null;

function ensureJsPdf(){
  if(_jspdfPromise) return _jspdfPromise;
  _jspdfPromise=loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js')
    .then(()=>loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'));
  return _jspdfPromise;
}

function activeProjectDisplayName(){
  return (document.getElementById('activeProjName') && document.getElementById('activeProjName').textContent) || 'Project';
}

async function exportPDF(){
  if(!savedFeatures.length){showToast('No features to export');return;}
  const btn=document.getElementById('exportFormatBtn'); const txt=document.getElementById('exportFormatBtnText');
  btn.disabled=true; txt.textContent='Loading engine…';
  document.getElementById('exportStatus').textContent='Loading PDF engine…';
  try{
    await ensureJsPdf();
    txt.textContent='Building PDF…';
    // Photos are raw base64 blobs — pointless (and enormous) in a printed table, so this table
    // drops that column. "Download Map Layout" is the format for a printable page with the
    // actual map, points, and legend; this one is the printable attribute table.
    const allRows=buildCSVString().split('\r\n').map(parseCsvLine);
    const header=allRows[0]||[];
    const dropIdx=header.indexOf('photo_data_uris');
    const rows=allRows.map(r=>dropIdx>-1 ? r.filter((_,i)=>i!==dropIdx) : r);
    const { jsPDF } = window.jspdf;
    const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
    doc.setFontSize(14);
    doc.text(`PlotEdge Export — ${activeProjectDisplayName()}`,24,28);
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`${savedFeatures.length} feature${savedFeatures.length===1?'':'s'} · ${new Date().toLocaleString()}`,24,42);
    doc.autoTable({
      head:[rows[0]||[]], body:rows.slice(1),
      startY:54, styles:{fontSize:6,cellPadding:2,overflow:'linebreak'},
      headStyles:{fillColor:[4,120,87],textColor:255},
      margin:{left:24,right:24}, theme:'grid'
    });
    doc.save(`plotedge_${ts()}.pdf`);
    document.getElementById('exportStatus').textContent=`✓ PDF report (${savedFeatures.length} features)`;
    showToast('PDF downloaded');
    markProjectExported();
  }catch(err){
    console.error(err);
    document.getElementById('exportStatus').textContent='PDF export failed';
    showToast('PDF export failed. Check console.');
  }finally{
    btn.disabled=false; updateExportFormatUI();
  }
}


// ══ MAP LAYOUT (.pdf) — a printable plan sheet: every feature plotted on a simple schematic
// (not raster basemap tiles — see note in EXPORT_FORMATS below for why), plus a legend of feature
// types/counts, a north arrow, and a scale bar. Everything is drawn with jsPDF's own vector
// primitives, so it works fully offline and never depends on tile-server CORS/loading. ══
function mapLayoutProjectPoint(lat,lon,proj){
  // Same equirectangular approximation used for the auto area/length attrs — consistent and
  // accurate at survey scale, and (unlike a raster basemap) lets the scale bar be exact rather
  // than estimated from a screenshot. At the small (survey-scale) extents this app is built for,
  // this is close enough to Web Mercator (what the raster basemap tiles below use) that the two
  // line up visually — the basemap is context, not a georeferenced product.
  const x=(lon*Math.PI/180)*proj.R*proj.cosLat;
  const y=(lat*Math.PI/180)*proj.R;
  return { x: proj.originX + (x-proj.x0)*proj.scale, y: proj.originY - (y-proj.y0)*proj.scale };
}


// ══ MAP LAYOUT BASEMAP (raster, optional) ══ — fetches OSM/Esri XYZ tiles covering the plot's
// lat/lon extent, stitches them into a canvas, and crops/scales that down to exactly the plot
// rect's pixel dimensions so it can be dropped in behind the vector features with doc.addImage().
// Same tile sources the Review tab's live map already uses (see reviewMapStreetLayer/
// reviewMapSatelliteLayer above), so no new CORS surface is being introduced.
function mapLayoutLonToTileX(lon,z){ return (lon+180)/360*Math.pow(2,z); }

function mapLayoutLatToTileY(lat,z){
  const rad=lat*Math.PI/180;
  return (1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*Math.pow(2,z);
}

function mapLayoutTileUrl(mode,x,y,z){
  if(mode==='satellite'){
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  const sub=['a','b','c'][(x+y)%3];
  return `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

// Fetches one tile as bytes (not via an <img> tag) so a successful CORS-enabled response decodes
// straight into an ImageBitmap without tainting the canvas we draw it onto. Both tile sources used
// here send Access-Control-Allow-Origin: *; a tile that fails (offline, rate-limited, etc.) just
// resolves to null and is left blank rather than aborting the whole basemap.
async function mapLayoutFetchTile(mode,x,y,z){
  try{
    const res=await fetch(mapLayoutTileUrl(mode,x,y,z),{mode:'cors'});
    if(!res.ok) return null;
    const blob=await res.blob();
    return await createImageBitmap(blob);
  }catch(e){ return null; }
}

// bbox = {west,south,east,north} in degrees. targetW/targetH = desired output pixel size (the
// exact pixel footprint of the plot rect, at export DPI). Returns a PNG data URL cropped/scaled
// to that exact size, or null if not enough tiles could be fetched to be worth showing.
async function mapLayoutBuildBasemapImage(bbox,targetW,targetH,mode){
  const MAX_TILES=64, MAX_Z=mode==='satellite'?18:19, MIN_Z=2;
  let z=MIN_Z, x1,x2,y1,y2,tx0,tx1,ty0,ty1;
  for(z=MIN_Z; z<=MAX_Z; z++){
    x1=mapLayoutLonToTileX(bbox.west,z); x2=mapLayoutLonToTileX(bbox.east,z);
    y1=mapLayoutLatToTileY(bbox.north,z); y2=mapLayoutLatToTileY(bbox.south,z);
    tx0=Math.floor(x1); tx1=Math.floor(x2); ty0=Math.floor(y1); ty1=Math.floor(y2);
    const tileCount=(tx1-tx0+1)*(ty1-ty0+1);
    const pxSpanX=(x2-x1)*256, pxSpanY=(y2-y1)*256;
    // Stop increasing zoom once resolution comfortably covers the target output, or once one more
    // zoom level would blow past the tile-count budget (then use the previous z's numbers).
    if((pxSpanX>=targetW && pxSpanY>=targetH) || tileCount>MAX_TILES){
      if(tileCount>MAX_TILES && z>MIN_Z){
        z--; x1=mapLayoutLonToTileX(bbox.west,z); x2=mapLayoutLonToTileX(bbox.east,z);
        y1=mapLayoutLatToTileY(bbox.north,z); y2=mapLayoutLatToTileY(bbox.south,z);
        tx0=Math.floor(x1); tx1=Math.floor(x2); ty0=Math.floor(y1); ty1=Math.floor(y2);
      }
      break;
    }
  }
  const cols=tx1-tx0+1, rows=ty1-ty0+1;
  const stitch=document.createElement('canvas');
  stitch.width=cols*256; stitch.height=rows*256;
  const sctx=stitch.getContext('2d');
  const fetches=[];
  for(let ty=ty0; ty<=ty1; ty++){
    for(let tx=tx0; tx<=tx1; tx++){
      fetches.push(mapLayoutFetchTile(mode,tx,ty,z).then(bmp=>{
        if(bmp) sctx.drawImage(bmp,(tx-tx0)*256,(ty-ty0)*256);
        return !!bmp;
      }));
    }
  }
  const results=await Promise.all(fetches);
  const okCount=results.filter(Boolean).length;
  if(okCount===0) return null; // no basemap worth showing — export falls back to plain schematic
  // Crop the stitched sheet down to exactly the requested lat/lon bbox, then scale to the target
  // output pixel size in one draw so the final image lines up with the plot rect pixel-for-pixel.
  const cropX=(x1-tx0)*256, cropY=(y1-ty0)*256;
  const cropW=(x2-x1)*256, cropH=(y2-y1)*256;
  const out=document.createElement('canvas');
  out.width=targetW; out.height=targetH;
  const octx=out.getContext('2d');
  octx.drawImage(stitch,cropX,cropY,cropW,cropH,0,0,targetW,targetH);
  return out.toDataURL('image/png');
}

async function exportMapLayout(){
  if(!savedFeatures.length){showToast('No features to export');return;}
  const btn=document.getElementById('exportFormatBtn'); const txt=document.getElementById('exportFormatBtnText');
  btn.disabled=true; txt.textContent='Loading engine…';
  document.getElementById('exportStatus').textContent='Loading PDF engine…';
  try{
    await ensureJsPdf();
    txt.textContent='Building layout…';
    const allVerts=savedFeatures.flatMap(f=>(f.vertices||[]).map(v=>({...v,ft:f.featureTypeId})));
    if(!allVerts.length){ showToast('No captured points to plot'); btn.disabled=false; updateExportFormatUI(); return; }
    const lats=allVerts.map(v=>v.lat), lons=allVerts.map(v=>v.lon);
    const latAvg=lats.reduce((s,v)=>s+v,0)/lats.length;
    const R=6378137, cosLat=Math.cos(latAvg*Math.PI/180);
    const toXY=(lat,lon)=>({ x:(lon*Math.PI/180)*R*cosLat, y:(lat*Math.PI/180)*R });
    const xs=allVerts.map(v=>toXY(v.lat,v.lon).x), ys=allVerts.map(v=>toXY(v.lat,v.lon).y);
    const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
    const spanX=Math.max(maxX-minX,1), spanY=Math.max(maxY-minY,1);

    const { jsPDF } = window.jspdf;
    const doc=new jsPDF({orientation:'portrait',unit:'pt',format:'a4'});
    const pageW=doc.internal.pageSize.getWidth(), pageH=doc.internal.pageSize.getHeight();
    const margin=36, plotTop=90, plotBottom=pageH-140;
    const plotW=pageW-margin*2, plotH=plotBottom-plotTop;
    // Fit the data's bounding box into the plot area with a 10% pad, preserving aspect ratio so
    // the scale bar is genuinely uniform in both directions rather than stretched.
    const pad=1.1;
    const scale=Math.min(plotW/(spanX*pad), plotH/(spanY*pad));
    const proj={ R,cosLat,scale,x0:(minX+maxX)/2,y0:(minY+maxY)/2,
      originX:margin+plotW/2, originY:plotTop+plotH/2 };

    doc.setFontSize(16); doc.setTextColor(20);
    doc.text(`${activeProjectDisplayName()} — Map Layout`,margin,32);
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`${savedFeatures.length} feature${savedFeatures.length===1?'':'s'} · ${new Date().toLocaleDateString()}`,margin,48);

    // Optional raster basemap — drawn first so the vector features/legend/scale bar below always
    // render on top of it. Uses the same lat/lon pad as the vector fit (so the tiles cover exactly
    // the plot rect) converted back from the equirect projection already computed above.
    let basemapAttribution=null;
    const basemapMode=maplayoutBasemapMode();
    if(basemapMode!=='none'){
      txt.textContent='Fetching basemap tiles…';
      document.getElementById('exportStatus').textContent='Fetching basemap tiles…';
      // Corners of the plot rect in the same equirect meters used for the vectors, converted back
      // to lat/lon — this is the exact geographic extent the plot rect represents.
      const halfW=(plotW/2)/scale, halfH=(plotH/2)/scale;
      const toLatLon=(x,y)=>({ lat:(y*180)/(R*Math.PI), lon:(x/(R*cosLat))*180/Math.PI });
      const nw=toLatLon(proj.x0-halfW, proj.y0+halfH), se=toLatLon(proj.x0+halfW, proj.y0-halfH);
      const bbox={ west:nw.lon, north:nw.lat, east:se.lon, south:se.lat };
      // Render at 2x the PDF's own points-per-inch-ish resolution for a crisp print, capped by the
      // tile-count budget inside mapLayoutBuildBasemapImage.
      const dpiScale=2;
      try{
        const dataUrl=await mapLayoutBuildBasemapImage(bbox, Math.round(plotW*dpiScale), Math.round(plotH*dpiScale), basemapMode);
        if(dataUrl){
          doc.addImage(dataUrl,'PNG',margin,plotTop,plotW,plotH);
          basemapAttribution = basemapMode==='satellite'
            ? 'Basemap: Esri, Maxar, Earthstar Geographics'
            : 'Basemap: © OpenStreetMap contributors';
        }
      }catch(e){ console.error('Map layout basemap fetch failed',e); }
      txt.textContent='Building layout…';
      document.getElementById('exportStatus').textContent='Building layout…';
    }

    doc.setDrawColor(210); doc.setLineWidth(0.75);
    doc.rect(margin,plotTop,plotW,plotH);

    // Plot each feature (point/line/polygon) in its type's color.
    savedFeatures.forEach(f=>{
      const verts=f.vertices||[];
      if(!verts.length) return;
      const color=featureTypeColor(f.featureTypeId);
      const rgb=[parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16)];
      const pts=verts.map(v=>mapLayoutProjectPoint(v.lat,v.lon,proj));
      if(f.geometryType==='polygon' && pts.length>=3){
        doc.setFillColor(...rgb); doc.setDrawColor(...rgb);
        doc.setGState && doc.setGState(new doc.GState({opacity:0.18}));
        doc.lines(pts.slice(1).map((p,i)=>[p.x-pts[i].x,p.y-pts[i].y]),pts[0].x,pts[0].y,[1,1],'F',true);
        doc.setGState && doc.setGState(new doc.GState({opacity:1}));
        doc.setLineWidth(1.2);
        doc.lines(pts.slice(1).map((p,i)=>[p.x-pts[i].x,p.y-pts[i].y]),pts[0].x,pts[0].y,[1,1],'S',true);
      } else if(f.geometryType==='line' && pts.length>=2){
        doc.setDrawColor(...rgb); doc.setLineWidth(1.5);
        for(let i=1;i<pts.length;i++) doc.line(pts[i-1].x,pts[i-1].y,pts[i].x,pts[i].y);
      } else {
        doc.setFillColor(...rgb);
        pts.forEach(p=>doc.circle(p.x,p.y,2.6,'F'));
      }
    });

    // Legend — one row per feature type actually used, with color swatch + feature count.
    const typeCounts={};
    savedFeatures.forEach(f=>{ typeCounts[f.featureTypeId]=(typeCounts[f.featureTypeId]||0)+1; });
    let legendY=plotBottom+22;
    doc.setFontSize(10); doc.setTextColor(20);
    doc.text('Legend',margin,legendY);
    legendY+=14;
    Object.keys(typeCounts).forEach(ftId=>{
      const ft=getFeatureType(ftId);
      const color=featureTypeColor(ftId);
      const rgb=[parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16)];
      doc.setFillColor(...rgb); doc.rect(margin,legendY-8,10,10,'F');
      doc.setFontSize(9); doc.setTextColor(60);
      doc.text(`${(ft&&ft.name)||'Unknown type'} (${typeCounts[ftId]})`,margin+16,legendY);
      legendY+=15;
    });

    // North arrow — top-right of the plot box. This layout is always drawn north-up (lat
    // increases toward the top of the page), so it's a fixed vertical arrow, not compass-derived.
    const naX=margin+plotW-28, naY=plotTop+34;
    doc.setDrawColor(20); doc.setFillColor(20); doc.setLineWidth(1.2);
    doc.line(naX,naY+18,naX,naY-14);
    doc.triangle(naX-6,naY-6,naX+6,naY-6,naX,naY-16,'F');
    doc.setFontSize(10); doc.text('N',naX-3,naY+30);

    // Scale bar — bottom-left of the plot box. Picks a "nice" round ground distance, then draws
    // it at the exact page length that distance maps to under this layout's own projection scale
    // (proj.scale is meters→page-points), so it's a true scale bar, not an estimate.
    const niceSteps=[1,2,5,10,20,25,50,100,200,250,500,1000,2000,5000,10000];
    const targetPagePts=90;
    let niceM=niceSteps[0];
    for(const step of niceSteps){ if(step*proj.scale<=targetPagePts) niceM=step; else break; }
    const barLen=niceM*proj.scale;
    const barX=margin+8, barY=plotBottom-14;
    doc.setDrawColor(20); doc.setLineWidth(1.2);
    doc.line(barX,barY,barX+barLen,barY);
    doc.line(barX,barY-4,barX,barY+4);
    doc.line(barX+barLen,barY-4,barX+barLen,barY+4);
    doc.setFontSize(8); doc.setTextColor(20);
    doc.text(`${niceM} m`,barX,barY-7);

    doc.setFontSize(7.5); doc.setTextColor(150);
    doc.text(
      basemapAttribution
        ? `Coordinates are exact; basemap imagery is approximate context only. ${basemapAttribution}`
        : 'Schematic plan — point positions only, not a raster basemap. Coordinates are exact; background scenery is not shown.',
      margin,pageH-16
    );

    doc.save(`plotedge_layout_${ts()}.pdf`);
    document.getElementById('exportStatus').textContent='✓ Map layout PDF';
    showToast('Map layout downloaded');
    markProjectExported();
  }catch(err){
    console.error(err);
    document.getElementById('exportStatus').textContent='Map layout export failed';
    showToast('Map layout export failed. Check console.');
  }finally{
    btn.disabled=false; updateExportFormatUI();
  }
}


// ══ PLOTEDGE BACKUP (round-trip import/export) ══
// Every other export* function above produces a one-way, read-only format for other GIS/office
// software. This is the opposite: a lossless snapshot of PlotEdge's own data model that PlotEdge
// itself can read back in, so people without a backend can move projects between devices or keep
// an offline archive that isn't just a localStorage wipe away from gone.
//
// Format choice: plain JSON, not a zip. Photos are already stored as base64 data-URLs inside
// savedFeatures[].vertices[].photos[], so a JSON dump is *already* complete and lossless with zero
// extra packing work — no separate photos/ folder to keep in sync with a manifest, no zip engine
// (JSZip) required, and the file opens in a text editor or renders in a browser tab if anyone
// wants to eyeball it. The trade-off is size (base64 is ~33% bigger than raw bytes, and JSON isn't
// compressed), which is why "Backup all projects" and per-project backups are offered as separate,
// deliberate actions rather than something that fires automatically.
const PE_BACKUP_VERSION = 1;

function peBackupEnvelope(kind){
  return { peBackup: PE_BACKUP_VERSION, app:'PlotEdge', kind, exportedAt: new Date().toISOString() };
}

// Strips runtime-only fields a re-import shouldn't carry over (sync/publish state is device- and
// session-specific, and re-importing a stale copy shouldn't claim to already be backed up).
function peBackupProjectMeta(p){
  const { id, lastExportedAt, ...meta } = p;
  return meta;
}

function peBackupProjectData(d){
  d = d || {};
  return {
    savedFeatures: d.savedFeatures || [],
    currentVertices: d.currentVertices || [],
    featureTypes: d.featureTypes || [],
    notes: d.notes || '',
    notesUpdatedAt: d.notesUpdatedAt || null,
    sketches: d.sketches || []
  };
}

// ── Export: current open project (used by the Export tab's format dropdown, like every other
// export*() in this file — reads the live in-memory globals, which are more current than
// projectData[activeProjectId] in the middle of an unsaved edit). ──
function exportProjectBackup(){
  if (!activeProjectId){ showToast('Open a project first'); return; }
  const p = projects.find(x=>x.id===activeProjectId);
  if (!p){ showToast('Project not found'); return; }
  const payload = {
    ...peBackupEnvelope('project'),
    project: peBackupProjectMeta(p),
    data: peBackupProjectData({ savedFeatures, currentVertices, featureTypes, notes:projectNotes, notesUpdatedAt:projectNotesUpdatedAt, sketches:plotetchSketches })
  };
  dl(JSON.stringify(payload), sanitizeFileSegment(p.name||'Project') + '_backup_' + ts() + '.plotedge.json', 'application/json');
  markProjectExported();
  showToast('✓ Backup downloaded — importable back into PlotEdge');
}

// ── Export: a specific project from the Project Manager menu, whether or not it's the one
// currently open. Reads from the store (projectData[id]) rather than live globals, same as
// exportProjectZip() does for the same reason. ──
function exportProjectBackupById(id){
  const p = projects.find(x=>x.id===id);
  if (!p){ showToast('Project not found'); return; }
  const d = projectData[id];
  if (!d || !((d.savedFeatures||[]).length || (d.currentVertices||[]).length)){
    showToast('No captured features in this project yet'); return;
  }
  const payload = { ...peBackupEnvelope('project'), project: peBackupProjectMeta(p), data: peBackupProjectData(d) };
  dl(JSON.stringify(payload), sanitizeFileSegment(p.name||'Project') + '_backup_' + ts() + '.plotedge.json', 'application/json');
  p.lastExportedAt = new Date().toISOString();
  persistStore();
  refreshProjectsScreen();
  if (activeProjectId === p.id) refreshExportMeta();
  showToast('✓ "' + p.name + '" backed up');
}

// ── Export: every project in one file — the "Backup all projects" button on the Welcome and
// Project Manager screens. Flushes the currently open project first so its latest edits (which
// only live in the in-memory globals until persist() runs) aren't missed. ──
function exportAllProjectsBackup(){
  if (!projects.length){ showToast('No projects to back up'); return; }
  if (activeProjectId) persist();
  const payload = {
    ...peBackupEnvelope('all'),
    projects: projects.map(peBackupProjectMeta),
    data: Object.fromEntries(projects.map(p => [p.id, peBackupProjectData(projectData[p.id])]))
  };
  dl(JSON.stringify(payload), 'PlotEdge_backup_' + ts() + '.plotedge.json', 'application/json');
  const now = new Date().toISOString();
  projects.forEach(p => p.lastExportedAt = now);
  persistStore();
  refreshProjectsScreen();
  showToast('✓ Backed up ' + projects.length + ' project' + (projects.length===1?'':'s'));
}


// ── Import from the Import tab ──
// Same parsing and same additive guarantee as the Projects-screen import above, but this one is
// reached from *inside* an open project. It deliberately does NOT call refreshProjectsScreen():
// that navigates back out to the Project Manager, which would throw away whatever capture the
// crew had on screen. Instead it reports inline and offers an explicit Open, so leaving the
// current project is always the user's choice.
function handleProjectBackupImport(event){
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  const out = document.getElementById('projectBackupResult');
  if (!file) return;
  const fail = msg => { out.innerHTML = '<div class="empty-box"><strong>Import failed</strong>' + escapeHtml(msg) + '</div>'; };
  out.innerHTML = '<div class="import-status">Reading ' + escapeHtml(file.name) + '…</div>';
  const reader = new FileReader();
  reader.onerror = () => fail('Could not read that file.');
  reader.onload = () => {
    let payload;
    try { payload = JSON.parse(reader.result); }
    catch(e){ return fail('That file isn’t valid JSON. Pick a .plotedge.json backup.'); }
    if (!payload || payload.peBackup !== PE_BACKUP_VERSION || !payload.kind){
      return fail('That isn’t a PlotEdge backup file. Use a .plotedge.json exported from PlotEdge.');
    }
    let ids = [];
    try {
      if (payload.kind === 'project'){
        ids.push(importOneBackupProject(payload.project, payload.data));
      } else if (payload.kind === 'all'){
        (payload.projects || []).forEach(meta => ids.push(importOneBackupProject(meta, (payload.data||{})[meta.id])));
      } else {
        return fail('Unrecognised backup type.');
      }
      persistStore();
    } catch(e){
      console.error(e);
      return fail('The file is a PlotEdge backup but its contents look corrupted.');
    }
    if (!ids.length) return fail('That backup contained no projects.');
    const rows = ids.map(id => {
      const p = projects.find(x=>x.id===id);
      const n = ((projectData[id]||{}).savedFeatures||[]).length;
      return '<div class="attr-sum-row" role="button" tabindex="0" onclick="openImportedProject(\'' + id + '\')">' +
        '<div class="attr-sum-body">' +
          '<div class="attr-sum-label">Imported</div>' +
          '<div class="attr-sum-val">' + escapeHtml(p ? p.name : id) + ' · ' + n + ' feature' + (n===1?'':'s') + '</div>' +
        '</div>' +
        '<span class="attr-sum-chev"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>' +
      '</div>';
    }).join('');
    out.innerHTML = rows + '<div class="import-status">Tap a project above to open it. Your current project stays open until you do.</div>';
    showToast('✓ Imported ' + ids.length + ' project' + (ids.length===1?'':'s'));
  };
  reader.readAsText(file);
}

function openImportedProject(id){
  if (!projects.find(x=>x.id===id)){ showToast('That project no longer exists'); return; }
  if (activeProjectId) persist();
  openProject(id);
}


// ── Import ──
// Always additive: an imported project (or every project in an "all" backup) lands as a brand
// new project with a freshly minted id, never overwriting anything already on this device. That
// makes import safe to try — worst case you end up with an extra project to delete, never a
// clobbered one.
function triggerBackupImport(){ document.getElementById('backupImportInput').click(); }

function peUniqueName(base){
  base = base || 'Imported project';
  const taken = new Set(projects.map(p=>p.name));
  if (!taken.has(base)) return base;
  let n = 2, name = base + ' (imported)';
  while (taken.has(name)) name = base + ' (imported ' + (n++) + ')';
  return name;
}

function importOneBackupProject(meta, data){
  const id = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const now = new Date().toISOString();
  projects.push({ ...(meta||{}), id, name: peUniqueName((meta||{}).name), createdAt:(meta&&meta.createdAt)||now, updatedAt:now, lastExportedAt:null });
  projectData[id] = peBackupProjectData(data);
  return id;
}

function handleBackupImportFile(event){
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let payload;
    try { payload = JSON.parse(reader.result); }
    catch(e){ showToast('Not a valid backup file (bad JSON)'); return; }
    if (!payload || payload.peBackup !== PE_BACKUP_VERSION || !payload.kind){
      showToast('Not a PlotEdge backup file'); return;
    }
    try {
      if (payload.kind === 'project'){
        importOneBackupProject(payload.project, payload.data);
        showToast('✓ Imported "' + peUniqueName((payload.project||{}).name).replace(/ \(imported.*\)$/,'') + '"');
      } else if (payload.kind === 'all'){
        const list = payload.projects || [];
        list.forEach(meta => importOneBackupProject(meta, (payload.data||{})[meta.id]));
        showToast('✓ Imported ' + list.length + ' project' + (list.length===1?'':'s'));
      } else {
        showToast('Unrecognized backup file'); return;
      }
      persistStore();
      refreshProjectsScreen();
    } catch(e){
      console.error(e);
      showToast('Import failed — file may be corrupted');
    }
  };
  reader.onerror = () => showToast('Could not read that file');
  reader.readAsText(file);
}


// ══ EXPORT FORMAT DROPDOWN — one card, one button; the select just swaps which underlying
// export*() function the button calls and updates its description/note/color to match. ══
const EXPORT_FORMATS = {
  plotedge: { label:'Download Backup', btnClass:'btn-geo', run:exportProjectBackup,
    desc:'A single <code>.plotedge.json</code> file with every feature, photo, note and sketch in this project — the one format PlotEdge can import straight back in. Use it for device-to-device transfers or as a true backup; everything else below is a one-way export for other software.',
    note:'Photos are embedded as base64, so this file can be noticeably larger than the GIS formats below. To back up every project at once, use "Backup all projects" on the Projects screen instead of repeating this per project.' },
  geojson: { label:'Download GeoJSON', btnClass:'btn-geo', run:exportGeoJSON,
    desc:'Each layer as a separate <code>.geojson</code> file. All attributes included as properties. Load directly in QGIS or ArcGIS.', note:null },
  gpkg: { label:'Download GeoPackage', btnClass:'btn-gpkg', run:exportGeoPackage,
    desc:'All layers in one <code>.gpkg</code> (SQLite) file, grouped by feature type as separate tables. Opens directly in QGIS/ArcGIS with no format conversion.',
    note:'First tap loads a small SQLite engine from a CDN (needs network signal once). GeoPackage and FlatGeobuf files are heavier to build than GeoJSON/CSV, so on datasets over ~500 features the status line below the button shows live progress rather than appearing frozen.' },
  fgb: { label:'Download FlatGeobuf', btnClass:'btn-fgb', run:exportFlatGeobuf,
    desc:'Each layer as a compact, streamable <code>.fgb</code> file. Good for large datasets and fast partial loading in web maps or QGIS.',
    note:'First tap loads a small serializer from a CDN (needs network signal once).' },
  geoparquet: { label:'Download GeoParquet', btnClass:'btn-fgb', run:exportGeoParquet,
    desc:'Each layer as a columnar <code>.parquet</code> file (GeoParquet 1.1, WKB geometry). Compact, fast to query with DuckDB/GeoPandas, and opens directly in QGIS 3.28+ or ArcGIS Pro.',
    note:'First tap loads a small parquet-writer engine from a CDN (needs network signal once).' },
  csv: { label:'Download CSV', btnClass:'btn-csv', run:exportCSV,
    desc:'One row per point. All layer attributes included as columns. Sort by <code>reference_id</code> to compare with your other app.', note:null },
  xlsx: { label:'Download Excel', btnClass:'btn-csv', run:exportExcel,
    desc:'Same table as CSV, as a native <code>.xlsx</code> workbook — opens directly in Excel with no import step.',
    note:'First tap loads a small spreadsheet engine from a CDN (needs network signal once). Embedded photos are included as base64 text in the photo_data_uris column, not as viewable images in the cell — free spreadsheet libraries can\'t render inline images, only paid ones can. Use "Download Photos" or GeoJSON/GPKG/FlatGeobuf if you need openable image files.' },
  pdf: { label:'Download PDF Report', btnClass:'btn-csv', run:exportPDF,
    desc:'Printable table of every feature and its attributes as a paginated <code>.pdf</code>. Good for review, sign-off, or printing in the field.',
    note:'First tap loads a small PDF engine from a CDN (needs network signal once). Photos aren\'t included in this table — use "Download Photos" for those, or "Download Map Layout" for a printable page with the actual plotted points, legend, and scale.' },
  maplayout: { label:'Download Map Layout', btnClass:'btn-gpkg', run:exportMapLayout,
    desc:'A single-page <code>.pdf</code> plan sheet: every point/line/polygon plotted to scale, with a legend, north arrow, and scale bar.',
    note:'First tap loads a small PDF engine from a CDN (needs network signal once). This is a schematic plan (exact coordinates, plain background) rather than a raster satellite/street basemap — so it works fully offline with no map-tile downloads.' },
  photos: { label:'Download Photos', btnClass:'btn-photos', run:exportPhotos,
    desc:'Downloads each photo named <code>Layer_FeatureName_photo1.jpg</code>. Chrome downloads one at a time.', note:null }
};

// ── Map Layout basemap mode ── 'none' | 'street' | 'satellite', remembered across sessions the
// same way the Review tab's own basemap preference is (separate key though — this one governs
// what gets baked into the exported PDF, which is a bigger/slower decision than just what you're
// looking at on screen, so they're allowed to differ).
const MAPLAYOUT_BASEMAP_KEY='plotedge_maplayout_basemap';

function maplayoutBasemapMode(){ try{ return localStorage.getItem(MAPLAYOUT_BASEMAP_KEY)||'none'; }catch(e){ return 'none'; } }

// Reflects a mode onto the seg-control buttons only (no storage write, no recursion) — used both
// by the click handler below and by updateExportFormatUI when the field is (re)shown.
function setMaplayoutBasemapModeUIOnly(mode){
  ['None','Street','Satellite'].forEach(label=>{
    const btn=document.getElementById('maplayoutBasemap'+label);
    if(btn) btn.classList.toggle('active', label.toLowerCase()===mode);
  });
}

function setMaplayoutBasemapMode(mode){
  try{ localStorage.setItem(MAPLAYOUT_BASEMAP_KEY,mode); }catch(e){}
  updateExportFormatUI();
}

function updateExportFormatUI(){
  const key=document.getElementById('exportFormatSelect').value;
  const f=EXPORT_FORMATS[key];
  document.getElementById('exportFormatDesc').innerHTML=f.desc;
  const btn=document.getElementById('exportFormatBtn');
  btn.className='btn '+f.btnClass;
  document.getElementById('exportFormatBtnText').textContent=f.label;
  const note=document.getElementById('exportFormatNote');
  let noteText=f.note;
  const basemapField=document.getElementById('maplayoutBasemapField');
  if(key==='maplayout'){
    basemapField.style.display='block';
    const mode=maplayoutBasemapMode();
    setMaplayoutBasemapModeUIOnly(mode);
    noteText = mode==='none'
      ? 'First tap loads a small PDF engine from a CDN (needs network signal once). This is a schematic plan (exact coordinates, plain background) — pick Street or Satellite above to draw a real basemap behind your features instead.'
      : `First tap loads a small PDF engine plus ${mode} map tiles for the area covered by your features (needs a live connection at export time). If tiles can't be fetched the layout still exports, just without the basemap.`;
  } else {
    basemapField.style.display='none';
  }
  if(noteText){ note.style.display='flex'; document.getElementById('exportFormatNoteText').textContent=noteText; }
  else note.style.display='none';
}

function runSelectedExport(){
  const key=document.getElementById('exportFormatSelect').value;
  EXPORT_FORMATS[key].run();
}
