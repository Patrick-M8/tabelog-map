// Hardened client for GitHub Pages
const MANIFEST_URL = 'geojson/manifest.json';
const CENTROIDS_URL = 'geojson/category_centroids.min.json';
const DEFAULT_RADIUS_KM = 3;
const CLOSING_SOON_M = 45;
const LO_SOON_M = 30;
const MAX_ZOOM_ON_FLY = 16;
let manifest = null;
let centroids = {};
let map, markersLayer, myMarker = null, myRing = null;
let currentSort = 'closing';
let selectedCats = new Set();
let catsCache = new Map();
let featuresAll = [];
let filtered = [];
let units = 'km';
let radiusKm = DEFAULT_RADIUS_KM;
const $ = sel => document.querySelector(sel);
const tpl = id => document.getElementById(id).content.firstElementChild.cloneNode(true);
const toRad = d => d*Math.PI/180;
const clamp = (v,min,max) => Math.max(min, Math.min(max, v));
function haversine(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function kmToM(km){ return km*1000; }
function kmToMi(km){ return km*0.621371; }
function miToKm(mi){ return mi/0.621371; }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); ) }
function parseHash(){
  const h = new URLSearchParams(location.hash.slice(1));
  return {
    sort: h.get('sort') || 'closing',
    cats: (h.get('cats') || '').split(',').filter(Boolean),
    lat: parseFloat(h.get('lat')), lng: parseFloat(h.get('lng')),
    z: parseInt(h.get('z') || '13', 10),
    r: parseFloat(h.get('r') || String(DEFAULT_RADIUS_KM)),
    u: (h.get('u') || 'km')
  };
}
function writeHash(obj){
  const h = new URLSearchParams(location.hash.slice(1));
  Object.entries(obj).forEach(([k,v]) => { if(v===null||v===undefined||v==='') h.delete(k); else h.set(k,v); });
  location.hash = h.toString();
}
function showBanner(msg){
  let el = document.getElementById('banner');
  if(!el){
    el = document.createElement('div');
    el.id = 'banner';
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:20000;background:#7f1d1d;color:#fff;padding:8px 12px;font:14px/1.4 system-ui';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}
function initMap(state){
  map = L.map('map', { zoomControl: true });
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { subdomains: 'abcd', maxZoom: 20, detectRetina: true, attribution: '&copy; OpenStreetMap contributors, © CARTO' }
  ).addTo(map);
  const lat = isFinite(state.lat) ? state.lat : 35.681236;
  const lng = isFinite(state.lng) ? state.lng : 139.767125;
  const z   = isFinite(state.z)   ? clamp(state.z, 2, 19) : 13;
  map.setView([lat, lng], z);
  markersLayer = L.layerGroup().addTo(map);
  map.on('moveend', () => {
    const c = map.getCenter();
    writeHash({ lat: c.lat.toFixed(5), lng: c.lng.toFixed(5), z: map.getZoom() });
    if(!myMarker){ ensureRingAt(c.lat, c.lng); refreshAll(); } else { refreshNearbyCounts(); }
  });
}
async function boot(){
  try {
    const s = parseHash();
    currentSort = s.sort || 'closing';
    units = (s.u === 'mi') ? 'mi' : 'km';
    radiusKm = isFinite(s.r) ? (s.u === 'mi' ? miToKm(s.r) : s.r) : DEFAULT_RADIUS_KM;
    initMap(s); bindUI();
    if(isFinite(s.lat) && isFinite(s.lng)){ ensureRingAt(s.lat, s.lng);
    } else {
      navigator.geolocation?.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        ensureRingAt(latitude, longitude, true);
        map.setView([latitude, longitude], 14);
        writeHash({ lat: latitude.toFixed(5), lng: longitude.toFixed(5), z: map.getZoom() });
      }, () => { const c = map.getCenter(); ensureRingAt(c.lat, c.lng); });
    }
    manifest = await safeFetchJson(MANIFEST_URL);
    if(!manifest || !Array.isArray(manifest.categories) || !manifest.categories.length){
      showBanner('Missing or empty geojson/manifest.json. Run your builder to create it.');
      console.error('Manifest load failed or has no categories.', manifest); return;
    }
    centroids = await safeFetchJson(CENTROIDS_URL) || {};
    if(s.cats.length){ const valid = s.cats.filter(k => manifest.categories.some(c => c.key === k)); selectedCats = new Set(valid); }
    if(!selectedCats.size){ selectedCats = new Set(manifest.categories.map(c => c.key)); writeHash({ cats: [...selectedCats].join(',') }); }
    buildCategoriesPanel(); selectSortButton(currentSort); updateRadiusUI();
    await loadSelectedCategories(); refreshAll();
  } catch (err){ showBanner('A runtime error occurred. Open DevTools console for details.'); console.error(err); }
}
async function safeFetchJson(url){
  try { const res = await fetch(url, { cache: 'no-cache' }); if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`); return await res.json(); }
  catch(e){ console.warn('Fetch failed:', url, e); return null; }
}
function bindUI(){
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => { currentSort = btn.dataset.sort; selectSortButton(currentSort); writeHash({ sort: currentSort }); renderList(); });
  });
  $('#locate')?.addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      ensureRingAt(latitude, longitude, true);
      map.setView([latitude, longitude], 14);
      writeHash({ lat: latitude.toFixed(5), lng: longitude.toFixed(5), z: map.getZoom() });
      refreshAll();
    }, err => { showBanner('Geolocation failed or was denied. Using map center.'); console.warn(err); const c = map.getCenter(); ensureRingAt(c.lat, c.lng); refreshAll(); });
  });
  $('#radius')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value); if(!isFinite(v)) return;
    radiusKm = (units === 'mi') ? miToKm(v) : v; updateRadiusUI(); resizeRing();
    writeHash({ r: (units === 'mi' ? kmToMi(radiusKm) : radiusKm).toFixed(2), u: units }); refreshAll();
  });
  $('#units')?.addEventListener('change', e => {
    const newU = e.target.value === 'mi' ? 'mi' : 'km';
    if(newU !== units){ units = newU; updateRadiusUI(); resizeRing();
      writeHash({ r: (units === 'mi' ? kmToMi(radiusKm) : radiusKm).toFixed(2), u: units }); refreshAll(); }
  });
  window.addEventListener('hashchange', () => {
    const s = parseHash();
    if(s.sort && s.sort !== currentSort){ currentSort = s.sort; selectSortButton(currentSort); renderList(); }
    if(s.u && s.u !== units){ units = s.u; updateRadiusUI(); resizeRing(); refreshAll(); }
    if(isFinite(s.r)){ radiusKm = (units === 'mi') ? miToKm(s.r) : s.r; updateRadiusUI(); resizeRing(); refreshAll(); }
    if(s.cats && s.cats.length){ const next = new Set(s.cats); if(diffSets(selectedCats, next)){ selectedCats = next; buildCategoriesPanel(); loadSelectedCategories().then(refreshAll); } }
  });
}
function selectSortButton(key){ document.querySelectorAll('.sort-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sort === key))); }
function diffSets(a,b){ if(a.size !== b.size) return true; for(const v of a) if(!b.has(v)) return true; return false; }
function ensureRingAt(lat, lng, showMarker=true){
  if(showMarker){ if(!myMarker) myMarker = L.marker([lat, lng], { title: 'You are here' }).addTo(map); else myMarker.setLatLng([lat,lng]); }
  if(!myRing){
    myRing = L.circle([lat, lng], { radius: kmToM(radiusKm), color: '#7dd3fc', weight: 1, fillColor: '#7dd3fc', fillOpacity: 0.08 }).addTo(map);
  } else { myRing.setLatLng([lat,lng]); myRing.setRadius(kmToM(radiusKm)); }
}
function resizeRing(){ if(myRing) myRing.setRadius(kmToM(radiusKm)); }
function ringCenter(){ return myRing ? myRing.getLatLng() : map.getCenter(); }
function buildCategoriesPanel(){
  const wrap = $('#cats-list'); if(!wrap){ console.warn('No #cats-list element'); return; }
  wrap.innerHTML = '';
  const center = ringCenter(); const radiusM = kmToM(radiusKm);
  const haveCentroids = centroids && typeof centroids === 'object';
  manifest.categories.forEach(c => {
    const pts = haveCentroids ? (centroids[c.key] || []) : null;
    const n = pts ? pts.reduce((acc, [lng,lat]) => acc + (haversine(center.lat, center.lng, lat, lng) <= radiusM ? 1 : 0), 0) : '–';
    const id = `cat_${c.key}`; const label = document.createElement('label'); const left = document.createElement('span'); const right = document.createElement('small');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = id; cb.value = c.key; cb.checked = selectedCats.has(c.key);
    cb.addEventListener('change', async () => { if(cb.checked) selectedCats.add(c.key); else selectedCats.delete(c.key);
      writeHash({ cats: [...selectedCats].join(',') }); await loadSelectedCategories(); refreshAll(); updateCatsSummary(); });
    left.appendChild(cb); left.appendChild(document.createTextNode(' ' + c.label)); right.textContent = `(${n})`;
    label.appendChild(left); label.appendChild(right); wrap.appendChild(label);
  });
  $('#cats-all')?.addEventListener('click', async () => { manifest.categories.forEach(c => selectedCats.add(c.key));
    writeHash({ cats: [...selectedCats].join(',') }); buildCategoriesPanel(); await loadSelectedCategories(); refreshAll(); updateCatsSummary(); });
  $('#cats-none')?.addEventListener('click', async () => { selectedCats.clear(); writeHash({ cats: '' }); buildCategoriesPanel();
    featuresAll = []; filtered = []; renderMap(); renderList(); updateCatsSummary(); });
  updateCatsSummary();
}
function updateCatsSummary(){ const sum = $('#cats-summary'); if(sum) sum.textContent = selectedCats.size ? `Categories (${selectedCats.size} selected)` : 'Categories (none)'; }
function refreshNearbyCounts(){ if(manifest) buildCategoriesPanel(); }
async function loadSelectedCategories(){
  const keys = [...selectedCats]; const toFetch = keys.filter(k => !catsCache.has(k));
  if(toFetch.length){ await Promise.all(toFetch.map(async k => { const entry = manifest.categories.find(c => c.key === k); if(!entry) return;
      const fc = await safeFetchJson(entry.url); if(fc && Array.isArray(fc.features)){ catsCache.set(k, fc); } else { console.warn('Bad or empty GeoJSON for', k, entry.url); catsCache.set(k, {type:'FeatureCollection',features:[]}); } })); }
  featuresAll = keys.flatMap(k => (catsCache.get(k)?.features || []));
}
function filterByRing(){
  if(!myRing){ filtered = featuresAll; return; }
  const c = myRing.getLatLng(); const radiusM = kmToM(radiusKm);
  filtered = featuresAll.filter(f => { const [lng,lat] = f.geometry.coordinates; return haversine(c.lat, c.lng, lat, lng) <= radiusM; });
}
function refreshAll(){ filterByRing(); renderMap(); renderList(); }
function renderMap(){
  markersLayer.clearLayers(); const bounds = [];
  filtered.forEach(f => {
    const [lng, lat] = f.geometry.coordinates; const status = f.properties.hours.open_now.status;
    const circle = L.circleMarker([lat, lng], { radius: 7, weight:1, color: '#000', fillColor: status==='open' ? '#10b981' : (status==='closed' ? '#6b7280' : '#f59e0b'), fillOpacity:0.9 });
    circle.bindPopup(`<strong>${escapeHtml(f.properties.name)}</strong><br>${escapeHtml(f.properties.hours.today_compact)}`);
    circle.addTo(markersLayer); bounds.push([lat, lng]);
  });
  if(bounds.length){ const b = L.latLngBounds(bounds); if(!map.getBounds().contains(b)){ map.fitBounds(b.pad(0.1), { maxZoom: 15 }); } }
}
function sortFeatures(arr, key){
  const byClosing = (a,b) => { const ar=a.properties.sort_keys, br=b.properties.sort_keys;
    const orank = (br.open_rank||0) - (ar.open_rank||0); if(orank) return orank;
    const ac=ar.closes_in_min??1e9, bc=br.closes_in_min??1e9; if(ac!==bc) return ac-bc;
    const at=(a.properties.ratings.tabelog.score||0), bt=(b.properties.ratings.tabelog.score||0); return bt-at; };
  const byPrice = (a,b) => { const ap=a.properties.sort_keys.price_min??1e9, bp=b.properties.sort_keys.price_min??1e9;
    if(ap!==bp) return ap-bp; const at=(a.properties.ratings.tabelog.score||0), bt=(b.properties.ratings.tabelog.score||0); return bt-at; };
  const copy = [...arr]; copy.sort(key==='price' ? byPrice : byClosing); return copy;
}
function renderList(){
  const list = $('#list'); if(!list) return; list.innerHTML = '';
  const sorted = sortFeatures(filtered, currentSort);
  if(!sorted.length){ const msg = document.createElement('div'); msg.style.cssText = 'padding:10px;color:#cbd5e1';
    msg.textContent = 'No restaurants in range. Try increasing the radius or selecting more categories.'; list.appendChild(msg); return; }
  sorted.forEach(f => list.appendChild(renderCard(f)));
}
function renderCard(f){
  const p = f.properties; const c = tpl('card-tpl');
  const img = c.querySelector('.img'); const nm = c.querySelector('.name'); const st = c.querySelector('.status');
  const today = c.querySelector('.today'); const chips = c.querySelector('.chips'); const ratings = c.querySelector('.ratings'); const links = c.querySelector('.links');
  img.style.backgroundImage = p.image_url ? `url("${p.image_url}")` : 'linear-gradient(135deg,#111,#222)';
  img.setAttribute('aria-label', p.name || p.name_local || ''); nm.textContent = p.name || p.name_local || '(no name)';
  const on = p.hours.open_now; let label = 'Closed', cls='closed';
  if(on.status === 'open'){ const parts=[]; if(isFinite(on.lo_in_min) && on.lo_in_min>0) parts.push(`LO in ${on.lo_in_min}m`);
    if(isFinite(on.closes_in_min)) parts.push(`Closes in ${on.closes_in_min}m`); label = parts.join(' · ') || 'Open';
    cls = (isFinite(on.closes_in_min) && on.closes_in_min <= CLOSING_SOON_M) || (isFinite(on.lo_in_min) && on.lo_in_min <= LO_SOON_M) ? 'soon' : 'open'; }
  st.textContent = label; st.classList.add('status', cls);
  today.textContent = p.hours.today_compact || '';
  const priceBucket = p.price?.bucket; if(priceBucket && priceBucket>0){ const chip = document.createElement('span'); chip.className='chip'; chip.textContent = '¥'.repeat(Math.min(priceBucket,5)); chips.appendChild(chip); }
  (p.sub_categories||[]).slice(0,2).forEach(sc => { const s = document.createElement('span'); s.className='chip'; s.textContent = sc; chips.appendChild(s); });
  (p.hours?.policy_chips||[]).forEach(pc => { const s = document.createElement('span'); s.className='chip'; s.textContent = pc; chips.appendChild(s); });
  const t = p.ratings?.tabelog, g = p.ratings?.google;
  const r1 = document.createElement('div'); r1.textContent = `Tabelog ★ ${t?.score ?? '-' } (${t?.reviews ?? '-'})`; ratings.appendChild(r1);
  const r2 = document.createElement('div'); r2.textContent = `Google ★ ${g?.score ?? '-' } (${g?.reviews ?? '-'})`; ratings.appendChild(r2);
  const [lng, lat] = f.geometry.coordinates; const qName = encodeURIComponent(p.name || p.name_local || ''); const q = `${qName}%20${lat.toFixed(6)},${lng.toFixed(6)}`;
  const gSearch = `https://www.google.com/maps/search/?api=1&query=${q}`;
  if(p.urls?.tabelog){ const a = document.createElement('a'); a.href=p.urls.tabelog; a.target='_blank'; a.rel='noopener'; a.textContent='Tabelog'; links.appendChild(a); }
  const b = document.createElement('a'); b.href=gSearch; b.target='_blank'; b.rel='noopener'; b.textContent='Directions'; links.appendChild(b);
  c.addEventListener('click', () => { map.flyTo([lat, lng], Math.max(MAX_ZOOM_ON_FLY, map.getZoom())); });
  return c;
}
function updateRadiusUI(){
  const u = $('#units'), r = $('#radius'), rv = $('#radius-val'); if(!u || !r || !rv) return;
  u.value = units; const disp = (units === 'mi') ? kmToMi(radiusKm) : radiusKm;
  rv.textContent = disp.toFixed(disp < 5 ? 1 : 0);
  r.min = (units === 'mi') ? '0.3' : '0.5'; r.max = (units === 'mi') ? '6' : '10'; r.step = (units === 'mi') ? '0.25' : '0.5';
  r.value = parseFloat(disp.toFixed(2));
}
document.addEventListener('DOMContentLoaded', boot);
