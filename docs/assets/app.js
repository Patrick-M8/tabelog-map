// Minimal client for GitHub Pages
const MANIFEST_URL = 'geojson/manifest.json';
const CENTROIDS_URL = 'geojson/category_centroids.min.json';
const RADIUS_M = 3000;       // "nearby" radius for dropdown counts
const CLOSING_SOON_M = 45;   // minutes to closing
const LO_SOON_M = 30;        // minutes to last order

let manifest = null;
let centroids = null;
let map, markersLayer;
let currentCatKey = null;
let currentSort = 'closing';
let features = [];  // loaded features for selected category

// --- tiny utils ---
const $ = sel => document.querySelector(sel);
const tpl = id => document.getElementById(id).content.firstElementChild.cloneNode(true);

function toRad(d){ return d*Math.PI/180; }
function haversine(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function parseHash(){
  const h = new URLSearchParams(location.hash.slice(1));
  return {
    cat: h.get('cat'),
    sort: h.get('sort') || 'closing',
    lat: parseFloat(h.get('lat')),
    lng: parseFloat(h.get('lng')),
    z: parseInt(h.get('z') || '13', 10)
  };
}
function writeHash(obj){
  const h = new URLSearchParams(location.hash.slice(1));
  Object.entries(obj).forEach(([k,v]) => {
    if(v === null || v === undefined || v === '') h.delete(k);
    else h.set(k, v);
  });
  location.hash = h.toString();
}

// --- map init ---
function initMap(state){
  map = L.map('map', { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(map);
  const lat = isFinite(state.lat) ? state.lat : 35.681236;
  const lng = isFinite(state.lng) ? state.lng : 139.767125;
  const z   = isFinite(state.z)   ? state.z   : 13;
  map.setView([lat, lng], z);
  map.on('moveend', debounce(refreshNearbyCounts, 250));
  markersLayer = L.layerGroup().addTo(map);
}

function debounce(fn, ms){
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// --- data boot ---
async function boot(){
  const state = parseHash();
  initMap(state);

  // try geolocation if no coords in hash
  if(!isFinite(state.lat) || !isFinite(state.lng)){
    navigator.geolocation?.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 14);
      writeHash({ lat: latitude.toFixed(5), lng: longitude.toFixed(5), z: map.getZoom() });
      refreshNearbyCounts();
    });
  }

  [manifest, centroids] = await Promise.all([
    fetch(MANIFEST_URL).then(r=>r.json()),
    fetch(CENTROIDS_URL).then(r=>r.json())
  ]);

  buildCategoryDropdown();
  bindUI();

  // choose initial category
  const catFromHash = manifest.categories.find(c => c.key === state.cat)?.key;
  const initialCat = catFromHash || manifest.categories[0].key;
  currentSort = state.sort || 'closing';
  selectSortButton(currentSort);
  await loadCategory(initialCat);
}

// --- UI binding ---
function bindUI(){
  $('#cat').addEventListener('change', async (e) => {
    await loadCategory(e.target.value);
  });
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSort = btn.dataset.sort;
      selectSortButton(currentSort);
      renderList(); // re-sort
    });
  });
  $('#locate').addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 14);
      writeHash({ lat: latitude.toFixed(5), lng: longitude.toFixed(5), z: map.getZoom() });
      refreshNearbyCounts();
    });
  });
  map.on('moveend', () => {
    const c = map.getCenter();
    writeHash({ lat: c.lat.toFixed(5), lng: c.lng.toFixed(5), z: map.getZoom() });
  });
}

function selectSortButton(key){
  document.querySelectorAll('.sort-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sort === key)));
}

// --- dropdown with nearby counts ---
function buildCategoryDropdown(){
  const sel = $('#cat');
  sel.innerHTML = '';
  const center = map.getCenter();
  manifest.categories.forEach(c => {
    const pts = centroids[c.key] || [];
    const n = pts.reduce((acc, [lng,lat]) => acc + (haversine(center.lat, center.lng, lat, lng) <= RADIUS_M ? 1 : 0), 0);
    const opt = document.createElement('option');
    opt.value = c.key;
    opt.textContent = `${c.label} (${n})`;
    sel.appendChild(opt);
  });
  // reflect hash
  const state = parseHash();
  if(state.cat){
    const found = [...sel.options].find(o => o.value === state.cat);
    if(found) sel.value = state.cat;
  }
}

function refreshNearbyCounts(){
  buildCategoryDropdown();
}

// --- load category data ---
async function loadCategory(key){
  currentCatKey = key;
  writeHash({ cat: key, sort: currentSort });
  const entry = manifest.categories.find(c => c.key === key);
  if(!entry){ return; }
  const fc = await fetch(entry.url).then(r=>r.json());
  features = fc.features || [];
  renderMap();
  renderList();
}

// --- markers ---
function renderMap(){
  markersLayer.clearLayers();
  const bounds = [];
  features.forEach(f => {
    const [lng, lat] = f.geometry.coordinates;
    const status = f.properties.hours.open_now.status;
    const color = status === 'open' ? '#10b981' : 'closed' ? '#ef4444' : '#9aa3af';
    const circle = L.circleMarker([lat, lng], {
      radius: 7, weight:1, color: '#000', fillColor: status==='open' ? '#10b981' : (status==='closed' ? '#6b7280' : '#f59e0b'), fillOpacity:0.9
    });
    circle.bindPopup(`<strong>${escapeHtml(f.properties.name)}</strong><br>${escapeHtml(f.properties.hours.today_compact)}`);
    circle.addTo(markersLayer);
    bounds.push([lat, lng]);
  });
  if(bounds.length){
    const b = L.latLngBounds(bounds);
    // Avoid aggressive jumps if already roughly in view
    if(!map.getBounds().contains(b)){
      map.fitBounds(b.pad(0.1), { maxZoom: 15 });
    }
  }
}

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// --- list/cards ---
function renderList(){
  const list = $('#list');
  list.innerHTML = '';
  const sorted = sortFeatures(features, currentSort);
  sorted.forEach(f => list.appendChild(renderCard(f)));
}

function sortFeatures(arr, key){
  const byClosing = (a,b) => {
    const ar=a.properties.sort_keys, br=b.properties.sort_keys;
    const orank = (br.open_rank||0) - (ar.open_rank||0); if(orank) return orank;
    const ac=ar.closes_in_min??1e9, bc=br.closes_in_min??1e9;
    if(ac!==bc) return ac-bc;
    const at=(a.properties.ratings.tabelog.score||0), bt=(b.properties.ratings.tabelog.score||0);
    return bt-at;
  };
  const byPrice = (a,b) => {
    const ap=a.properties.sort_keys.price_min??1e9, bp=b.properties.sort_keys.price_min??1e9;
    if(ap!==bp) return ap-bp;
    const at=(a.properties.ratings.tabelog.score||0), bt=(b.properties.ratings.tabelog.score||0);
    return bt-at;
  };
  const copy = [...arr];
  copy.sort(key==='price' ? byPrice : byClosing);
  return copy;
}

function renderCard(f){
  const p = f.properties;
  const c = tpl('card-tpl');
  const img = c.querySelector('.img');
  const nm = c.querySelector('.name');
  const st = c.querySelector('.status');
  const today = c.querySelector('.today');
  const chips = c.querySelector('.chips');
  const ratings = c.querySelector('.ratings');
  const links = c.querySelector('.links');

  img.style.backgroundImage = p.image_url ? `url("${p.image_url}")` : 'linear-gradient(135deg,#111,#222)';
  img.setAttribute('aria-label', p.name);
  nm.textContent = p.name || '(no name)';

  // status pill
  const on = p.hours.open_now;
  let label = 'Closed', cls='closed';
  if(on.status === 'open'){
    const parts=[];
    if(isFinite(on.lo_in_min) && on.lo_in_min>0) parts.push(`LO in ${on.lo_in_min}m`);
    if(isFinite(on.closes_in_min)) parts.push(`Closes in ${on.closes_in_min}m`);
    label = parts.join(' · ') || 'Open';
    cls = (isFinite(on.closes_in_min) && on.closes_in_min <= CLOSING_SOON_M) || (isFinite(on.lo_in_min) && on.lo_in_min <= LO_SOON_M) ? 'soon' : 'open';
  }
  st.textContent = label;
  st.classList.add('status', cls);

  today.textContent = p.hours.today_compact;

  // chips: price + subcategory + policies
  const priceBucket = p.price?.bucket;
  if(priceBucket && priceBucket>0){
    const chip = document.createElement('span'); chip.className='chip'; chip.textContent = '¥'.repeat(Math.min(priceBucket,5));
    chips.appendChild(chip);
  }
  (p.sub_categories||[]).slice(0,2).forEach(sc => {
    const s = document.createElement('span'); s.className='chip'; s.textContent = sc; chips.appendChild(s);
  });
  (p.hours?.policy_chips||[]).forEach(pc => {
    const s = document.createElement('span'); s.className='chip'; s.textContent = pc; chips.appendChild(s);
  });

  // ratings
  const t = p.ratings?.tabelog, g = p.ratings?.google;
  const r1 = document.createElement('div'); r1.textContent = `Tabelog ★ ${t?.score ?? '-' } (${t?.reviews ?? '-'})`;
  ratings.appendChild(r1);
  const r2 = document.createElement('div'); r2.textContent = `Google ★ ${g?.score ?? '-' } (${g?.reviews ?? '-'})`;
  ratings.appendChild(r2);

  // links
  if(p.urls?.tabelog){
    const a = document.createElement('a'); a.href=p.urls.tabelog; a.target='_blank'; a.rel='noopener'; a.textContent='Tabelog';
    links.appendChild(a);
  }
  if(p.urls?.google){
    const a = document.createElement('a'); a.href=p.urls.google; a.target='_blank'; a.rel='noopener'; a.textContent='Directions';
    links.appendChild(a);
  }

  // click to fly
  c.addEventListener('click', () => {
    const [lng, lat] = f.geometry.coordinates;
    map.flyTo([lat, lng], Math.max(16, map.getZoom()));
  });

  return c;
}

// --- helpers ---
window.addEventListener('hashchange', () => {
  const s = parseHash();
  if(s.cat && s.cat !== currentCatKey){
    loadCategory(s.cat);
    $('#cat').value = s.cat;
  }
  if(s.sort && s.sort !== currentSort){
    currentSort = s.sort; selectSortButton(currentSort); renderList();
  }
});

// init
document.addEventListener('DOMContentLoaded', boot);
