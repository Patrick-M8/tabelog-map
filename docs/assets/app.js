(function () {
  if (window.__TBLG_APP_LOADED) {
    console.warn('app.js already loaded — skipping second run');
    return;
  }
  window.__TBLG_APP_LOADED = true;

  'use strict';

  const MANIFEST_URL = 'geojson/manifest.json';
  const CENTROIDS_URL = 'geojson/category_centroids.min.json';
  const DEFAULT_RADIUS_KM = 3;
  const CLOSING_SOON_M = 45;
  const LO_SOON_M = 30;
  const MAX_ZOOM_ON_FLY = 16;

  let manifest = null;
  let centroids = {};
  let map = null, markersLayer = null, myMarker = null, myRing = null;
  let currentSort = 'closing';
  let sortDir = 'asc';
  let selectedCats = new Set();
  const catsCache = new Map();
  let featuresAll = [];
  let filtered = [];
  let units = 'km';
  let radiusKm = DEFAULT_RADIUS_KM;
  let onlyWithinRing = true;
  const cardIndex = new Map();
  const MAP_DRIFT_M = 60;
  let anchorCenter = null;

  // utils
  const $ = sel => document.querySelector(sel);
  const tpl = id => document.getElementById(id).content.firstElementChild.cloneNode(true);
  const toRad = d => d * Math.PI / 180;
  function haversine(lat1, lon1, lat2, lon2){
    const R = 6371000;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const kmToM = km => km * 1000;
  const kmToMi = km => km * 0.621371;
  const miToKm = mi => mi / 0.621371;

  function escapeHtml(s) {
    const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
    return String(s ?? '').replace(/[&<>"']/g, ch => map[ch]);
  }
  function userPoint(){
    if (myMarker) return myMarker.getLatLng();
    if (myRing)   return myRing.getLatLng();
    return map.getCenter();
  }
  function distanceFromUserMeters(f){
    const u = userPoint();
    const [lng, lat] = f.geometry.coordinates;
    return haversine(u.lat, u.lng, lat, lng);
  }
  function featureId(f){
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    const base = p.uid || p.id || p.urls?.tabelog || p.name || `${lat},${lng}`;
    return String(base).toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,80);
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
  function safeFetchJson(url){
    return fetch(url, { cache: 'no-cache' })
      .then(res => { if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`); return res.json(); })
      .catch(e => { console.warn('Fetch failed:', url, e); return null; });
  }

  // hash
  function parseHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    return {
      sort: h.get('sort') || 'closing',
      sd: (h.get('sd') || ''),
      cats: (h.get('cats') || '').split(',').filter(Boolean),
      lat: parseFloat(h.get('lat')),
      lng: parseFloat(h.get('lng')),
      z: parseInt(h.get('z') || '13', 10),
      r: parseFloat(h.get('r') || String(DEFAULT_RADIUS_KM)),
      u: (h.get('u') || 'km'),
      f: h.get('f') || '1',
      sb: h.get('sb') || '1'
    };
  }
  function writeHash(obj){
    const h = new URLSearchParams(location.hash.slice(1));
    Object.entries(obj).forEach(([k,v]) => {
      if (v === null || v === undefined || v === '') h.delete(k); else h.set(k, v);
    });
    location.hash = h.toString();
  }

  // map
  function initMap(state){
    if (map) return;
    const container = document.getElementById('map');
    if (!container) return;
    if (container._leaflet_id) container._leaflet_id = null;

    map = L.map('map', {
      zoomControl: true,
      closePopupOnClick: false // fixes first-click popup flicker
    });

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 20, detectRetina: true, attribution: '&copy; OpenStreetMap contributors, © CARTO' }
    ).addTo(map);

    const lat = isFinite(state.lat) ? state.lat : 35.681236;
    const lng = isFinite(state.lng) ? state.lng : 139.767125;
    const z   = isFinite(state.z)   ? Math.max(2, Math.min(19, state.z)) : 13;
    map.setView([lat, lng], z);

    markersLayer = L.layerGroup().addTo(map);

    map.on('moveend', () => {
      const c = map.getCenter();
      writeHash({ lat: c.lat.toFixed(5), lng: c.lng.toFixed(5), z: map.getZoom() });
      refreshNearbyCounts();
    });
    map.on('click', () => map.closePopup());
  }

  // tray handle (ensures whole header content is tucked)
  function ensureTrayHandle(){
    const header = document.querySelector('.topbar');
    if (!header) return;
  
    // default for safety
    if (!getComputedStyle(header).getPropertyValue('--tray-peek').trim()) {
      header.style.setProperty('--tray-peek', '36px');
    }
  
    let handle = document.getElementById('tray-handle');
    if (!handle) {
      handle = document.createElement('button');
      handle.id = 'tray-handle';
      handle.className = 'tray-handle';
      handle.type = 'button';
      handle.title = 'Show/Hide controls';
      handle.setAttribute('aria-expanded', 'true');
      handle.textContent = '▾';
      header.appendChild(handle);
    }
  
    const applyState = () => {
      const open = localStorage.getItem('tray_open') !== '0';
      header.classList.toggle('expanded', open);
      header.classList.toggle('collapsed', !open);
      handle.setAttribute('aria-expanded', String(open));
      handle.textContent = open ? '▾' : '▴';
    };
  
    applyState();
  
    handle.addEventListener('click', () => {
      const open = localStorage.getItem('tray_open') !== '0';
      localStorage.setItem('tray_open', open ? '0' : '1');
      applyState();
    });

  function enableCategoriesOverlay(){
    const cats = document.getElementById('cats-panel');
    if(!cats) return;
    const header = document.querySelector('.topbar');
    const menu = cats.querySelector('.cats-menu');
    if(!menu) return;
  
    let isOverlay = false;
  
    function placeMenu(){
      // Compute header bottom in viewport coords
      const rect = header.getBoundingClientRect();
      const topPx = Math.max(0, Math.round(rect.bottom));
      // When overlaying, position the menu as a fixed panel under header
      menu.classList.add('cats-overlay');
      menu.style.setProperty('--cats-top', `${topPx}px`);
      if (menu.parentElement !== document.body){
        document.body.appendChild(menu);
      }
      isOverlay = true;
    }
    function restoreMenu(){
      menu.classList.remove('cats-overlay');
      menu.style.removeProperty('--cats-top');
      if (menu.parentElement !== cats){
        cats.appendChild(menu);
      }
      isOverlay = false;
    }
  
    // Toggle overlay when details opens/closes
    cats.addEventListener('toggle', () => {
      if (cats.open) { placeMenu(); }
      else { restoreMenu(); }
    });
  
    // Keep overlay aligned if header height changes or viewport resizes
    ['resize', 'orientationchange'].forEach(ev =>
      window.addEventListener(ev, () => { if (isOverlay) placeMenu(); })
    );
    header.addEventListener('transitionend', () => { if (isOverlay) placeMenu(); });
  }

  }


  // boot
  async function boot(){
    const s = parseHash();
    currentSort = s.sort || 'closing';
    sortDir = (s.sd === 'asc' || s.sd === 'desc') ? s.sd : defaultDirFor(currentSort);
    units = (s.u === 'mi') ? 'mi' : 'km';
    radiusKm = isFinite(s.r) ? (s.u === 'mi' ? miToKm(s.r) : s.r) : DEFAULT_RADIUS_KM;
    onlyWithinRing = (s.f !== '0');

    initMap(s);
    bindUI();
    ensureTrayHandle();
    enableCategoriesOverlay(); 

    if(isFinite(s.lat) && isFinite(s.lng)){
      ensureRingAt(s.lat, s.lng, false);
    } else {
      navigator.geolocation?.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        ensureRingAt(latitude, longitude, true);
        map.setView([latitude, longitude], 14);
        writeHash({ lat: latitude.toFixed(5), lng: longitude.toFixed(5), z: map.getZoom() });
      }, () => {
        const c = map.getCenter(); ensureRingAt(c.lat, c.lng, false);
      });
    }

    manifest = await safeFetchJson(MANIFEST_URL);
    if(!manifest || !Array.isArray(manifest.categories) || !manifest.categories.length){
      showBanner('Missing or empty geojson/manifest.json. Run your builder to create it.');
      return;
    }
    centroids = await safeFetchJson(CENTROIDS_URL) || {};

    if(s.cats.length){
      const valid = s.cats.filter(k => manifest.categories.some(c => c.key === k));
      selectedCats = new Set(valid);
    }
    if(!selectedCats.size){
      selectedCats = new Set(manifest.categories.map(c => c.key));
      writeHash({ cats: [...selectedCats].join(',') });
    }

    buildCategoriesPanel();
    updateRadiusUI();
    const ft = $('#filter-toggle'); if(ft) ft.checked = onlyWithinRing;
    setSortUI(currentSort, sortDir);

    const sortPanel = $('#sort-panel');
    if (sortPanel) {
      sortPanel.open = (s.sb !== '0');
      sortPanel.addEventListener('toggle', () => {
        writeHash({ sb: sortPanel.open ? '1' : '0' });
      });
    }

  // Back-to-top: shows if list scrolled OR map drifted from anchor
  const backTop = document.getElementById('backTop');
  const listEl  = document.getElementById('list');
  
  function updateBackTopVisibility(){
    if(!backTop) return;
    const listScrolled = listEl ? (listEl.scrollTop > 60) : (window.scrollY > 60);
    let mapDrifted = false;
    if (map && anchorCenter){
      const c = map.getCenter();
      const d = haversine(c.lat, c.lng, anchorCenter.lat, anchorCenter.lng);
      mapDrifted = d >= MAP_DRIFT_M;
    }
    backTop.classList.toggle('show', listScrolled || mapDrifted);
  }
  
  if (backTop){
    backTop.addEventListener('click', () => {
      // Scroll BOTH, so it works regardless of which one is actually scrolling
      if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  
    const onListScroll = () => updateBackTopVisibility();
    if (listEl) listEl.addEventListener('scroll', onListScroll);
    else window.addEventListener('scroll', onListScroll);
  
    map.on('move', updateBackTopVisibility);
    map.on('moveend', updateBackTopVisibility);
  
    updateBackTopVisibility();
  }


    await loadSelectedCategories();
    refreshAll();
  }

  function bindUI(){
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sort;
        if (currentSort === key) sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
        else { currentSort = key; sortDir = defaultDirFor(key); }
        setSortUI(currentSort, sortDir);
        writeHash({ sort: currentSort, sd: sortDir });
        renderList();
      });
    });

    $('#locate')?.addEventListener('click', () => {
      navigator.geolocation?.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        ensureRingAt(latitude, longitude, true);
        map.setView([latitude, longitude], 14);
        writeHash({ lat: latitude.toFixed(5), lng: longitude.toFixed(5), z: map.getZoom() });
        refreshAll();
      }, () => {
        showBanner('Geolocation failed or was denied. Using map center.');
        const c = map.getCenter(); ensureRingAt(c.lat, c.lng, false); refreshAll();
      });
    });

    $('#radius')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value); if(!isFinite(v)) return;
      radiusKm = (units === 'mi') ? miToKm(v) : v;
      updateRadiusUI(); resizeRing();
      writeHash({ r: (units === 'mi' ? kmToMi(radiusKm) : radiusKm).toFixed(2), u: units });
      refreshAll(); refreshNearbyCounts();
    });

    $('#units')?.addEventListener('change', e => {
      const newU = e.target.value === 'mi' ? 'mi' : 'km';
      if(newU !== units){
        units = newU; updateRadiusUI(); resizeRing();
        writeHash({ r: (units === 'mi' ? kmToMi(radiusKm) : radiusKm).toFixed(2), u: units });
        refreshAll(); refreshNearbyCounts();
      }
    });

    $('#filter-toggle')?.addEventListener('change', (e) => {
      onlyWithinRing = e.target.checked;
      writeHash({ f: onlyWithinRing ? '1' : '0' });
      refreshAll();
    });

    window.addEventListener('hashchange', () => {
      const s = parseHash();
      if(s.sort && s.sort !== currentSort){ currentSort = s.sort; }
      if(s.sd){ sortDir = (s.sd === 'asc' ? 'asc' : 'desc'); }
      setSortUI(currentSort, sortDir);

      if(s.u && s.u !== units){ units = s.u; updateRadiusUI(); resizeRing(); refreshAll(); refreshNearbyCounts(); }
      if(isFinite(s.r)){ radiusKm = (units === 'mi') ? miToKm(s.r) : s.r; updateRadiusUI(); resizeRing(); refreshAll(); refreshNearbyCounts(); }
      if(s.f){ onlyWithinRing = (s.f !== '0'); const t = $('#filter-toggle'); if(t) t.checked = onlyWithinRing; }
      const sortPanel = $('#sort-panel'); if (sortPanel && s.sb) sortPanel.open = (s.sb !== '0');

      if(s.cats && s.cats.length){
        const next = new Set(s.cats);
        if(diffSets(selectedCats, next)){
          selectedCats = next;
          buildCategoriesPanel();
          loadSelectedCategories().then(refreshAll);
        } else { refreshAll(); }
      } else { refreshAll(); }
    });
  }

  function defaultDirFor(key){
    switch(key){
      case 'closing':  return 'asc';
      case 'price':    return 'asc';
      case 'distance': return 'asc';
      case 'rating_t': return 'desc';
      case 'rating_g': return 'desc';
      default:         return 'asc';
    }
  }
  function setSortUI(key, dir){
    document.querySelectorAll('.sort-btn').forEach(b => {
      const active = (b.dataset.sort === key);
      b.setAttribute('aria-pressed', String(active));
      const base = b.textContent.replace(/ ▲| ▼/g,'').trim();
      b.textContent = active ? `${base} ${dir === 'asc' ? '▲' : '▼'}` : base;
    });
  }
  function diffSets(a,b){
    if(a.size !== b.size) return true;
    for(const v of a) if(!b.has(v)) return true;
    return false;
  }

  // my location + ring
  function ensureRingAt(lat, lng, showMarker=true){
    if(showMarker){
      if(!myMarker) myMarker = L.marker([lat, lng], { title: 'You are here' }).addTo(map);
      else myMarker.setLatLng([lat,lng]);
    }
    if(!myRing){
      myRing = L.circle([lat, lng], {
        radius: kmToM(radiusKm),
        color: '#7dd3fc', weight: 1, fillColor: '#7dd3fc', fillOpacity: 0.08
      }).addTo(map);
    } else {
      myRing.setLatLng([lat,lng]);
      myRing.setRadius(kmToM(radiusKm));
    }

    anchorCenter = myRing.getLatLng();
  }
  function resizeRing(){ if(myRing) myRing.setRadius(kmToM(radiusKm)); }
  function ringCenter(){ return myRing ? myRing.getLatLng() : map.getCenter(); }

  // categories
  function buildCategoriesPanel(){
    const wrap = $('#cats-list'); if(!wrap){ console.warn('No #cats-list element'); return; }
    wrap.innerHTML = '';
    const center = ringCenter(); const radiusM = kmToM(radiusKm);
    const haveCentroids = centroids && typeof centroids === 'object';

    manifest.categories.forEach(c => {
      const pts = haveCentroids ? (centroids[c.key] || []) : null;
      const n = pts ? pts.reduce((acc, [lng,lat]) => acc + (haversine(center.lat, center.lng, lat, lng) <= radiusM ? 1 : 0), 0) : '–';

      const id = `cat_${c.key}`;
      const label = document.createElement('label');
      const left = document.createElement('span');
      const right = document.createElement('small');

      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = id; cb.value = c.key; cb.checked = selectedCats.has(c.key);
      cb.addEventListener('change', async () => {
        if(cb.checked) selectedCats.add(c.key); else selectedCats.delete(c.key);
        writeHash({ cats: [...selectedCats].join(',') }); await loadSelectedCategories(); refreshAll(); updateCatsSummary();
      });

      left.appendChild(cb); left.appendChild(document.createTextNode(' ' + c.label)); right.textContent = `(${n})`;
      label.appendChild(left); label.appendChild(right); wrap.appendChild(label);
    });

    $('#cats-all')?.addEventListener('click', async () => {
      manifest.categories.forEach(c => selectedCats.add(c.key));
      writeHash({ cats: [...selectedCats].join(',') }); buildCategoriesPanel();
      await loadSelectedCategories(); refreshAll(); updateCatsSummary();
    });
    $('#cats-none')?.addEventListener('click', async () => {
      selectedCats.clear(); writeHash({ cats: '' }); buildCategoriesPanel();
      featuresAll = []; filtered = []; renderMap(); renderList(); updateCatsSummary();
    });

    updateCatsSummary();
  }
  function updateCatsSummary(){
    const sum = $('#cats-summary'); if(sum) sum.textContent = selectedCats.size ? `Categories (${selectedCats.size} selected)` : 'Categories (none)';
  }
  function refreshNearbyCounts(){ if(manifest) buildCategoriesPanel(); }

  // data
  async function loadSelectedCategories(){
    const keys = [...selectedCats];
    const toFetch = keys.filter(k => !catsCache.has(k));
    if(toFetch.length){
      await Promise.all(toFetch.map(async k => {
        const entry = manifest.categories.find(c => c.key === k);
        if(!entry) return;
        const fc = await safeFetchJson(entry.url);
        catsCache.set(k, (fc && Array.isArray(fc.features)) ? fc : { type:'FeatureCollection', features: [] });
      }));
    }
    featuresAll = keys.flatMap(k => (catsCache.get(k)?.features || []));
  }

  // filter + render
  function filterByRing(){
    if(!onlyWithinRing || !myRing){ filtered = featuresAll; return; }
    const c = myRing.getLatLng(); const radiusM = kmToM(radiusKm);
    filtered = featuresAll.filter(f => {
      const [lng,lat] = f.geometry.coordinates;
      return haversine(c.lat, c.lng, lat, lng) <= radiusM;
    });
  }
  function refreshAll(){ filterByRing(); renderMap(); renderList(); }

  function yenBadge(bucket){ const n = Math.max(0, Math.min(5, bucket || 0)); return n > 0 ? '¥'.repeat(n) : ''; }

  function renderMap(){
    markersLayer.clearLayers();

    filtered.forEach(f => {
      const [lng, lat] = f.geometry.coordinates;
      const p = f.properties;
      const status = p.hours?.open_now?.status;

      // simple, non-badged circle markers (no ¥ on the map itself)
      const color = status==='open' ? '#10b981' : (status==='closed' ? '#6b7280' : '#f59e0b');
      const marker = L.circleMarker([lat, lng], { radius: 7, weight:1, color:'#000', fillColor: color, fillOpacity:0.9 });

      const fid = featureId(f);
      const name = p.name || p.name_local || '(no name)';
      const cuisines = (p.sub_categories || []).join(', ');
      const price = yenBadge(p.price?.bucket);

      // popup shows name + cuisines + (¥…)
      const html =
        `<a href="#" class="popup-name" data-fid="${fid}">${escapeHtml(name)}</a>` +
        (cuisines ? `<br><small>${escapeHtml(cuisines)}</small>` : '') +
        (price ? `<br><small>${price}</small>` : '');

      marker.bindPopup(html, { autoPan:true, closeButton:false, autoClose:true });
      marker.on('popupopen', (e) => {
        const el = e.popup.getElement() && e.popup.getElement().querySelector('a.popup-name');
        if(el){
          el.addEventListener('click', (ev) => {
            ev.preventDefault();
            scrollToCard(fid);
            map.closePopup();
          });
        }
      });

      markersLayer.addLayer(marker);
    });

    // No auto-fit
  }

  function sortFeatures(arr, key, dir){
    const cmpClosing = (A,B) => {
      const a = A.properties.sort_keys || {}, b = B.properties.sort_keys || {};
      const ao = a.open_rank || 0, bo = b.open_rank || 0;
      if(bo !== ao) return bo - ao;
      const ac = Number.isFinite(a.closes_in_min) ? a.closes_in_min : 1e9;
      const bc = Number.isFinite(b.closes_in_min) ? b.closes_in_min : 1e9;
      return ac - bc;
    };
    const cmpPrice = (A,B) => {
      const a = A.properties.sort_keys?.price_min ?? 1e9;
      const b = B.properties.sort_keys?.price_min ?? 1e9;
      return a - b;
    };
    const cmpRatingT = (A,B) => {
      const a = parseFloat(A.properties.ratings?.tabelog?.score ?? 0) || 0;
      const b = parseFloat(B.properties.ratings?.tabelog?.score ?? 0) || 0;
      return b - a;
    };
    const cmpRatingG = (A,B) => {
      const a = parseFloat(A.properties.ratings?.google?.score ?? 0) || 0;
      const b = parseFloat(B.properties.ratings?.google?.score ?? 0) || 0;
      return b - a;
    };
    const cmpDistance = (A,B) => distanceFromUserMeters(A) - distanceFromUserMeters(B);

    const copy = [...arr];
    let cmp;
    switch(key){
      case 'price':    cmp = cmpPrice;    break;
      case 'rating_t': cmp = cmpRatingT;  break;
      case 'rating_g': cmp = cmpRatingG;  break;
      case 'distance': cmp = cmpDistance; break;
      default:         cmp = cmpClosing;  break;
    }
    copy.sort(cmp);
    if (dir === 'desc') copy.reverse();
    return copy;
  }

  function renderList(){
    const list = $('#list'); if(!list) return;
    list.innerHTML = ''; cardIndex.clear();

    const sorted = sortFeatures(filtered, currentSort, sortDir);
    if(!sorted.length){
      const msg = document.createElement('div'); msg.style.cssText = 'padding:10px;color:#cbd5e1';
      msg.textContent = 'No restaurants to show. Increase the radius, select more categories, or disable the radius filter.';
      list.appendChild(msg); return;
    }
    sorted.forEach(f => {
      const node = renderCard(f);
      const fid = featureId(f);
      node.dataset.fid = fid;
      cardIndex.set(fid, node);
      list.appendChild(node);
    });
  }
  function updateBackTopVisibility(){
    const btn   = document.getElementById('backTop');
    if (!btn) return;
  
    // list scroll signal
    const list  = document.getElementById('list');
    const listScrolled = list ? (list.scrollTop > 60) : (window.scrollY > 60);
  
    // map drift signal
    let mapDrifted = false;
    if (map && anchorCenter) {
      const c = map.getCenter();
      const d = haversine(c.lat, c.lng, anchorCenter.lat, anchorCenter.lng);
      mapDrifted = d >= MAP_DRIFT_M;
    }
  
    // show if either condition is true
    btn.classList.toggle('show', listScrolled || mapDrifted);
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
    img.setAttribute('aria-label', p.name || p.name_local || '');
    nm.textContent = p.name || p.name_local || '(no name)';

    const on = p.hours?.open_now || {};
    let label = 'Closed', cls='closed';
    if(on.status === 'open'){
      const parts=[];
      if(Number.isFinite(on.lo_in_min) && on.lo_in_min>0) parts.push(`LO in ${on.lo_in_min}m`);
      if(Number.isFinite(on.closes_in_min)) parts.push(`Closes in ${on.closes_in_min}m`);
      label = parts.join(' · ') || 'Open';
      cls = (Number.isFinite(on.closes_in_min) && on.closes_in_min <= CLOSING_SOON_M) || (Number.isFinite(on.lo_in_min) && on.lo_in_min <= LO_SOON_M) ? 'soon' : 'open';
    }
    st.textContent = label; st.classList.add('status', cls);

    today.textContent = p.hours?.today_compact || '';

    const priceBucket = p.price?.bucket;
    if(priceBucket && priceBucket>0){
      const chip = document.createElement('span'); chip.className='chip'; chip.textContent = '¥'.repeat(Math.min(priceBucket,5));
      chips.appendChild(chip);
    }
    const d = distanceFromUserMeters(f);
    if (Number.isFinite(d)) {
      const chip = document.createElement('span'); chip.className='chip';
      const val = (units === 'mi') ? (d/1609.344) : (d/1000);
      chip.textContent = (units === 'mi') ? `${val.toFixed(val<10?1:0)} mi` : `${val.toFixed(val<10?1:0)} km`;
      chips.appendChild(chip);
    }
    (p.sub_categories||[]).slice(0,2).forEach(sc => { const s = document.createElement('span'); s.className='chip'; s.textContent = sc; chips.appendChild(s); });
    (p.hours?.policy_chips||[]).forEach(pc => { const s = document.createElement('span'); s.className='chip'; s.textContent = pc; chips.appendChild(s); });

    const t = p.ratings?.tabelog, g = p.ratings?.google;
    const r1 = document.createElement('div'); r1.textContent = `Tabelog ★ ${t?.score ?? '-' } (${t?.reviews ?? '-'})`; ratings.appendChild(r1);
    const r2 = document.createElement('div'); r2.textContent = `Google ★ ${g?.score ?? '-' } (${g?.reviews ?? '-'})`; ratings.appendChild(r2);

    const qName = encodeURIComponent(p.name || p.name_local || '');
    const gSearch = `https://www.google.com/maps/search/?api=1&query=${qName}`;
    if(p.urls?.tabelog){
      const a = document.createElement('a'); a.href=p.urls.tabelog; a.target='_blank'; a.rel='noopener'; a.textContent='Tabelog';
      links.appendChild(a);
    }
    const b = document.createElement('a'); b.href=gSearch; b.target='_blank'; b.rel='noopener'; b.textContent='Directions';
    links.appendChild(b);

    const [lng, lat] = f.geometry.coordinates;
    c.addEventListener('click', () => { map.flyTo([lat, lng], Math.max(MAX_ZOOM_ON_FLY, map.getZoom())); });

    return c;
  }

  function scrollToCard(fid){
    const el = cardIndex.get(fid); if(!el) return;
    el.classList.remove('flash'); void el.offsetWidth;
    el.classList.add('flash');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateRadiusUI(){
    const u = $('#units'), r = $('#radius'), rv = $('#radius-val'); if(!u || !r || !rv) return;
    u.value = units;
    const disp = (units === 'mi') ? kmToMi(radiusKm) : radiusKm;
    rv.textContent = disp.toFixed(disp < 5 ? 1 : 0);
    r.min = (units === 'mi') ? '0.3' : '0.5';
    r.max = (units === 'mi') ? '6'   : '10';
    r.step = (units === 'mi') ? '0.25': '0.5';
    r.value = parseFloat(disp.toFixed(2));
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.__TBLG_APP_STARTED) return;
    window.__TBLG_APP_STARTED = true;
    boot().catch(e => { console.error(e); showBanner('A runtime error occurred. Open DevTools console for details.'); });
  });

})();
