(function () {
  if (window.__TBLG_APP_LOADED) { console.warn('app.js already loaded — skipping'); return; }
  window.__TBLG_APP_LOADED = true;

  'use strict';

  // ---- Constants ----
  const MANIFEST_URL = 'geojson/manifest.json';
  const CENTROIDS_URL = 'geojson/category_centroids.min.json';
  const DEFAULT_RADIUS_KM = 3;
  const CLOSING_SOON_M = 45;
  const LO_SOON_M = 30;
  const MAX_ZOOM_ON_FLY = 16;
  const MAP_DRIFT_M = 60; // back-to-top shows if map moved >=60m from anchor
  const MAP_PAST_THRESHOLD_PX = 80; // map considered scrolled past if its bottom < 80px from viewport top

  // ---- State ----
  let manifest = null;
  let centroids = {};
  let map = null, markersLayer = null, myMarker = null, myRing = null;
  let currentSort = 'closing';
  let sortDir = 'asc';               // asc | desc
  let selectedCats = new Set();
  const catsCache = new Map();
  let featuresAll = [];
  let filtered = [];
  let units = 'km';
  let radiusKm = DEFAULT_RADIUS_KM;
  let onlyWithinRing = true;
  const cardIndex = new Map();       // fid -> DOM element
  let anchorCenter = null;           // ring center ("home" for back-to-top)
  let backTopManualHide = false;     // hides back-to-top until user scrolls/moves again
  let catsOverlayOpen = false;
  let catsOverlayEl = null;

  // ---- Utils ----
  const $ = sel => document.querySelector(sel);
  const tpl = id => document.getElementById(id).content.firstElementChild.cloneNode(true);
  const toRad = d => d * Math.PI / 180;
  function haversine(lat1, lon1, lat2, lon2){
    const R = 6371000;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
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
  // Format minutes as "1h 15m" / "2h" / "45m"
  function fmtHM(min){
    if (!Number.isFinite(min)) return '';
    const mm = Math.max(0, Math.round(min));
    const h = Math.floor(mm / 60);
    const m = mm % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }

  const DAY_ORDER = ['mon','tue','wed','thu','fri','sat','sun'];
  const WEEKDAY_TO_IDX = { monday:0, tuesday:1, wednesday:2, thursday:3, friday:4, saturday:5, sunday:6 };
  const SCHEDULE_TIMEZONE = 'Asia/Tokyo';

  function getNowPartsInTz(timeZone = SCHEDULE_TIMEZONE){
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const weekday = String(byType.weekday || '').toLowerCase();
    return {
      weekdayIdx: WEEKDAY_TO_IDX[weekday],
      hour: Number(byType.hour),
      minute: Number(byType.minute)
    };
  }

  function toMinutes(hhmm){
    if (!hhmm || typeof hhmm !== 'string') return null;
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return (h * 60) + m;
  }

  function compactTodayFromWeekly(weekly){
    if (!weekly || typeof weekly !== 'object') return 'Closed';
    const now = getNowPartsInTz();
    const todayKey = DAY_ORDER[now.weekdayIdx];
    const blocks = Array.isArray(weekly[todayKey]) ? weekly[todayKey] : [];
    if (!blocks.length) return 'Closed';

    const labels = [];
    blocks.forEach((b, idx) => {
      let seg = `${b.open}–${b.close}`;
      const lo = b.last_order;
      const loParts = [];
      if (lo){
        if (lo.food) loParts.push(`Food ${lo.food}`);
        if (lo.drinks) loParts.push(`Drinks ${lo.drinks}`);
        if (lo.generic && !loParts.length) loParts.push(lo.generic);
      }
      if (loParts.length) seg += ` (LO ${loParts.join(' / ')})`;
      labels.push(seg);

      const n = blocks[idx + 1];
      if (n) labels.push(`Break ${b.close}–${n.open}`);
    });

    return labels.join(' · ');
  }

  function calcOpenNowFromWeekly(weekly){
    if (!weekly || typeof weekly !== 'object') return { status:'closed' };

    const now = getNowPartsInTz();
    if (!Number.isFinite(now.weekdayIdx) || !Number.isFinite(now.hour) || !Number.isFinite(now.minute)) {
      return { status:'closed' };
    }

    const dowIdx = now.weekdayIdx;
    const nowMin = now.hour * 60 + now.minute;

    const todayKey = DAY_ORDER[dowIdx];
    const prevKey = DAY_ORDER[(dowIdx + 6) % 7];

    const todayBlocks = Array.isArray(weekly[todayKey]) ? weekly[todayKey] : [];
    const prevBlocks = Array.isArray(weekly[prevKey]) ? weekly[prevKey] : [];
    const blocks = [
      ...todayBlocks,
      ...prevBlocks.filter(b => b && b.crosses_midnight).map(b => ({ ...b, carried_from_prev:true }))
    ];

    if (!blocks.length) return { status:'closed' };

    for (const b of blocks){
      const start = toMinutes(b.open);
      const end = toMinutes(b.close);
      const crosses = !!b.crosses_midnight;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

      let inWindow = false;
      let closesIn = null;
      if (!crosses){
        inWindow = (start <= nowMin && nowMin < end);
        if (inWindow) closesIn = end - nowMin;
      } else {
        inWindow = (nowMin >= start) || (nowMin < end);
        if (inWindow) closesIn = nowMin >= start ? (24*60 - nowMin) + end : (end - nowMin);
      }

      if (!inWindow) continue;

      let loIn = null;
      const lo = b.last_order;
      if (lo && typeof lo === 'object'){
        const loTimes = ['generic','food','drinks'].map(k => toMinutes(lo[k])).filter(Number.isFinite);
        if (loTimes.length){
          const loT = Math.min(...loTimes);
          if (!crosses){
            loIn = (nowMin <= loT && loT <= end) ? Math.max(loT - nowMin, 0) : null;
          } else if (nowMin >= start){
            loIn = loT >= start ? Math.max(loT - nowMin, 0) : ((24*60 - nowMin) + loT);
          } else {
            loIn = loT >= nowMin ? Math.max(loT - nowMin, 0) : null;
          }
        }
      }

      return {
        status:'open',
        segment:{ start:b.open, end:b.close, last_order: lo || null },
        closes_in_min: closesIn,
        lo_in_min: loIn,
        crosses_midnight: crosses
      };
    }

    let firstFuture = null;
    for (const b of todayBlocks){
      const st = toMinutes(b.open);
      if (!Number.isFinite(st)) continue;
      if (st > nowMin){ firstFuture = st - nowMin; break; }
    }
    return { status:'closed', opens_in_min:firstFuture };
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

  // ---- URL state ----
  function parseHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    return {
      sort: h.get('sort') || 'closing',
      sd: (h.get('sd') || ''), // asc|desc
      cats: (h.get('cats') || '').split(',').filter(Boolean),
      lat: parseFloat(h.get('lat')),
      lng: parseFloat(h.get('lng')),
      z: parseInt(h.get('z') || '13', 10),
      r: parseFloat(h.get('r') || String(DEFAULT_RADIUS_KM)),
      u: (h.get('u') || 'km'),
      f: h.get('f') || '1',
      sb: h.get('sb') || '1' // sort panel open
    };
  }
  function writeHash(obj){
    const h = new URLSearchParams(location.hash.slice(1));
    Object.entries(obj).forEach(([k,v]) => {
      if (v === null || v === undefined || v === '') h.delete(k);
      else h.set(k, v);
    });
    location.hash = h.toString();
  }

  // ---- Map init (CARTO Voyager, retina) ----
  function initMap(state){
    if (map) return;
    const container = document.getElementById('map');
    if (!container) return;
    if (container._leaflet_id) container._leaflet_id = null;

    map = L.map('map', {
      zoomControl: true,
      closePopupOnClick: false
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
      updateBackTopVisibility();
    });
    map.on('click', () => map.closePopup());
    map.on('move', updateBackTopVisibility);
    map.on('movestart', () => { backTopManualHide = false; updateBackTopVisibility(); });
  }

  // ---- Tray handle (height-based; handle at bottom) ----
  function ensureTrayHandle(){
    const header = document.querySelector('.topbar');
    if (!header) return;

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
      handle.textContent = '▾'; // flips when collapsed
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
  }

  // ---- Ensure Categories control sits at very top of header ----
  function placeCatsFirstInHeader(){
    const controls = document.querySelector('.topbar .controls');
    const catsPanel = document.getElementById('cats-panel');
    if (controls && catsPanel && controls.firstElementChild !== catsPanel) {
      controls.insertBefore(catsPanel, controls.firstChild);
    }
  }

  // ---- Full-screen Categories Overlay (no <details> auto-toggle) ----
  function initCategoriesOverlay(){
    const cats = document.getElementById('cats-panel');
    if (!cats) return;
    const summary = cats.querySelector('summary');
    const legacyMenu = cats.querySelector('.cats-menu');
    if (legacyMenu) legacyMenu.style.display = 'none';       // hide old clipped menu
    if (cats.hasAttribute('open')) cats.removeAttribute('open');

    // build overlay once
    if (!catsOverlayEl){
      catsOverlayEl = document.createElement('div');
      catsOverlayEl.id = 'catsOverlay';
      catsOverlayEl.style.cssText =
        'position:fixed;inset:0;z-index:6000;display:none;background:rgba(8,12,20,.96);color:#e5e7eb;';
      catsOverlayEl.innerHTML = `
        <div id="catsOvPanel" style="position:absolute;inset:0;display:flex;flex-direction:column;">
          <div style="display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid rgba(255,255,255,.12)">
            <button id="catsOvClose" style="font-size:20px;line-height:1;border:none;background:transparent;color:#e5e7eb;cursor:pointer">✕</button>
            <div style="flex:1;text-align:center;font-weight:700">Categories</div>
            <div style="display:flex;gap:8px">
              <button id="catsOvAll"   style="padding:6px 10px;border-radius:8px;border:1px solid #334155;background:#0b1324;color:#e5e7eb;cursor:pointer">Select all</button>
              <button id="catsOvNone"  style="padding:6px 10px;border-radius:8px;border:1px solid #334155;background:#0b1324;color:#e5e7eb;cursor:pointer">Clear</button>
            </div>
          </div>
          <div id="catsOvList" style="flex:1;overflow:auto;padding:12px;display:grid;grid-template-columns:1fr;gap:8px"></div>
        </div>
      `;
      document.body.appendChild(catsOverlayEl);

      // actions
      catsOverlayEl.querySelector('#catsOvClose').addEventListener('click', closeCatsOverlay);
      catsOverlayEl.addEventListener('click', (e) => {
        if (e.target === catsOverlayEl) closeCatsOverlay(); // click backdrop
      });
      catsOverlayEl.querySelector('#catsOvAll').addEventListener('click', async () => {
        manifest.categories.forEach(c => selectedCats.add(c.key));
        writeHash({ cats: [...selectedCats].join(',') });
        buildCatsOverlayList(); // refresh checks
        await loadSelectedCategories(); refreshAll(); updateCatsSummary();
      });
      catsOverlayEl.querySelector('#catsOvNone').addEventListener('click', async () => {
        selectedCats.clear();
        writeHash({ cats: '' });
        buildCatsOverlayList();
        featuresAll = []; filtered = []; renderMap(); renderList(); updateCatsSummary();
      });
    }

    // Intercept summary to toggle overlay
    if (summary && !summary.__boundCats){
      summary.__boundCats = true;
      summary.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        catsOverlayOpen ? closeCatsOverlay() : openCatsOverlay();
      });
    }
  }

  function openCatsOverlay(){
    catsOverlayOpen = true;
    buildCatsOverlayList();
    catsOverlayEl.style.display = 'block';
  }
  function closeCatsOverlay(){
    catsOverlayOpen = false;
    catsOverlayEl.style.display = 'none';
  }

  function buildCatsOverlayList(){
    const list = document.getElementById('catsOvList');
    if (!list || !manifest) return;
    list.innerHTML = '';

    const center = ringCenter();
    const radiusM = kmToM(radiusKm);
    const haveCentroids = centroids && typeof centroids === 'object';

    manifest.categories.forEach(c => {
      const pts = haveCentroids ? (centroids[c.key] || []) : null;
      const n = pts ? pts.reduce((acc, [lng,lat]) => acc + (haversine(center.lat, center.lng, lat, lng) <= radiusM ? 1 : 0), 0) : '–';

      const row = document.createElement('label');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid #334155;border-radius:10px;background:#0b1324';
      const left = document.createElement('span');
      const right = document.createElement('small'); right.textContent = `(${n})`;
      right.style.opacity = '0.8';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedCats.has(c.key);
      cb.style.marginRight = '8px';
      cb.addEventListener('change', async () => {
        if (cb.checked) selectedCats.add(c.key); else selectedCats.delete(c.key);
        writeHash({ cats: [...selectedCats].join(',') });
        await loadSelectedCategories(); refreshAll(); updateCatsSummary();
        // Keep counts live as radius changes:
        buildCatsOverlayList();
      });

      left.appendChild(cb);
      left.appendChild(document.createTextNode(' ' + c.label));
      row.appendChild(left); row.appendChild(right);
      list.appendChild(row);
    });
  }

  // ---- Boot ----
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
    placeCatsFirstInHeader();
    initCategoriesOverlay();

    // set ring at hash coords, geolocation, or map center
    if(isFinite(s.lat) && isFinite(s.lng)){
      ensureRingAt(s.lat, s.lng, false);
    } else {
      navigator.geolocation?.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        ensureRingAt(latitude, longitude, true);
        map.setView([latitude, longitude], 14);
        writeHash({ lat: latitude.toFixed(5), lng: longitude.toFixed(5), z: map.getZoom() });
      }, () => {
        const c = map.getCenter();
        ensureRingAt(c.lat, c.lng, false);
      });
    }

    // data
    manifest = await safeFetchJson(MANIFEST_URL);
    if(!manifest || !Array.isArray(manifest.categories) || !manifest.categories.length){
      showBanner('Missing or empty geojson/manifest.json. Run your builder to create it.');
      return;
    }
    centroids = await safeFetchJson(CENTROIDS_URL) || {}; // optional

    // categories: from hash or all
    if(s.cats.length){
      const valid = s.cats.filter(k => manifest.categories.some(c => c.key === k));
      selectedCats = new Set(valid);
    }
    if(!selectedCats.size){
      selectedCats = new Set(manifest.categories.map(c => c.key));
      writeHash({ cats: [...selectedCats].join(',') });
    }

    // first build
    updateRadiusUI();
    const ft = $('#filter-toggle'); if(ft) ft.checked = onlyWithinRing;
    setSortUI(currentSort, sortDir);
    updateCatsSummary();

    // back-to-top wiring (list and window scroll)
    const backTop = document.getElementById('backTop');
    const listEl  = document.getElementById('list');
    if (backTop){
      backTop.addEventListener('click', () => {
        if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        backTopManualHide = true;
        updateBackTopVisibility();
      });

      const onListScroll = () => {
        if ((listEl && listEl.scrollTop > 5) || (!listEl && window.scrollY > 5)) {
          backTopManualHide = false;
        }
        updateBackTopVisibility();
      };
      if (listEl) listEl.addEventListener('scroll', onListScroll);
      window.addEventListener('scroll', onListScroll);

      updateBackTopVisibility();
    }

    await loadSelectedCategories();
    refreshAll();
  }

  // ---- UI bindings ----
  function bindUI(){
    // sort bar
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sort;
        if (currentSort === key) {
          sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
        } else {
          currentSort = key;
          sortDir = defaultDirFor(key);
        }
        setSortUI(currentSort, sortDir);
        writeHash({ sort: currentSort, sd: sortDir });
        renderList();
      });
    });

    // locate
    $('#locate')?.addEventListener('click', () => {
      navigator.geolocation?.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        ensureRingAt(latitude, longitude, true);
        map.setView([latitude, longitude], 14);
        writeHash({ lat: latitude.toFixed(5), lng: longitude.toFixed(5), z: map.getZoom() });
        refreshAll();
      }, () => {
        showBanner('Geolocation failed or was denied. Using map center.');
        const c = map.getCenter();
        ensureRingAt(c.lat, c.lng, false);
        refreshAll();
      });
    });

    // search radius
    $('#radius')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if(!isFinite(v)) return;
      radiusKm = (units === 'mi') ? miToKm(v) : v;
      updateRadiusUI();
      resizeRing();
      writeHash({ r: (units === 'mi' ? kmToMi(radiusKm) : radiusKm).toFixed(2), u: units });
      refreshAll();
      refreshNearbyCounts(); // update counts in overlay
      updateBackTopVisibility();
    });

    // units
    $('#units')?.addEventListener('change', e => {
      const newU = e.target.value === 'mi' ? 'mi' : 'km';
      if(newU !== units){
        units = newU;
        updateRadiusUI();
        resizeRing();
        writeHash({ r: (units === 'mi' ? kmToMi(radiusKm) : radiusKm).toFixed(2), u: units });
        refreshAll();
        refreshNearbyCounts();
        updateBackTopVisibility();
      }
    });

    // ring filter toggle
    $('#filter-toggle')?.addEventListener('change', (e) => {
      onlyWithinRing = e.target.checked;
      writeHash({ f: onlyWithinRing ? '1' : '0' });
      refreshAll();
      updateBackTopVisibility();
    });

    // hash changes
    window.addEventListener('hashchange', () => {
      const s = parseHash();
      if(s.sort && s.sort !== currentSort){ currentSort = s.sort; }
      if(s.sd){ sortDir = (s.sd === 'asc' ? 'asc' : 'desc'); }
      setSortUI(currentSort, sortDir);

      if(s.u && s.u !== units){ units = s.u; updateRadiusUI(); resizeRing(); refreshAll(); refreshNearbyCounts(); updateBackTopVisibility(); }
      if(isFinite(s.r)){ radiusKm = (units === 'mi') ? miToKm(s.r) : s.r; updateRadiusUI(); resizeRing(); refreshAll(); refreshNearbyCounts(); updateBackTopVisibility(); }
      if(s.f){ onlyWithinRing = (s.f !== '0'); const t = $('#filter-toggle'); if(t) t.checked = onlyWithinRing; refreshAll(); updateBackTopVisibility(); }
      const sortPanel = $('#sort-panel'); if (sortPanel && s.sb) sortPanel.open = (s.sb !== '0');

      if(s.cats && s.cats.length){
        const next = new Set(s.cats);
        if(diffSets(selectedCats, next)){
          selectedCats = next;
          buildCatsOverlayList();
          loadSelectedCategories().then(() => { refreshAll(); updateBackTopVisibility(); });
        } else {
          refreshAll(); updateBackTopVisibility();
        }
      } else {
        refreshAll(); updateBackTopVisibility();
      }
    });
  }

  // ---- Back-to-top visibility (list scroll OR map drift OR map scrolled past), with manual hide ----
  function isScrolledPastMap(){
    const m = document.getElementById('map');
    if (!m) return false;
    const rect = m.getBoundingClientRect();
    // If bottom of map is above top threshold -> past
    return rect.bottom < MAP_PAST_THRESHOLD_PX;
    // Works for stacked mobile layout; harmless on split layouts.
  }

  function updateBackTopVisibility(){
    const backTop = document.getElementById('backTop');
    if(!backTop) return;

    if (backTopManualHide) { backTop.classList.remove('show'); return; }

    const listEl  = document.getElementById('list');
    const listScrolled = listEl ? (listEl.scrollTop > 60) : (window.scrollY > 60);

    let mapDrifted = false;
    if (map && anchorCenter){
      const c = map.getCenter();
      const d = haversine(c.lat, c.lng, anchorCenter.lat, anchorCenter.lng);
      mapDrifted = d >= MAP_DRIFT_M;
    }

    const pastMap = isScrolledPastMap();

    backTop.classList.toggle('show', listScrolled || mapDrifted || pastMap);
  }

  // ---- Sorting helpers ----
  function defaultDirFor(key){
    switch(key){
      case 'closing':  return 'asc';  // soonest first
      case 'price':    return 'asc';  // cheapest first
      case 'distance': return 'asc';  // nearest first
      case 'rating_t': return 'desc'; // highest first
      case 'rating_g': return 'desc'; // highest first
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

  // ---- My location + ring ----
  function ensureRingAt(lat, lng, showMarker=true){
    if(showMarker){
      if(!myMarker) myMarker = L.marker([lat, lng], { title: 'You are here' }).addTo(map);
      else myMarker.setLatLng([lat,lng]);
    }
    if(!myRing){
      myRing = L.circle([lat, lng], {
        radius: kmToM(radiusKm),
        color: '#7dd3fc',
        weight: 1,
        fillColor: '#7dd3fc',
        fillOpacity: 0.08
      }).addTo(map);
    } else {
      myRing.setLatLng([lat,lng]);
      myRing.setRadius(kmToM(radiusKm));
    }
    // anchor for back-to-top logic
    anchorCenter = myRing.getLatLng();
    updateBackTopVisibility();
  }
  function resizeRing(){ if(myRing) myRing.setRadius(kmToM(radiusKm)); }
  function ringCenter(){ return myRing ? myRing.getLatLng() : map.getCenter(); }

  // ---- Categories summary text in header ----
  function updateCatsSummary(){
    const sum = $('#cats-summary');
    if(sum) sum.textContent = selectedCats.size ? `Categories (${selectedCats.size} selected)` : 'Categories (none)';
  }
  function refreshNearbyCounts(){
    if (catsOverlayOpen) buildCatsOverlayList();
  }

  // ---- Data loading ----
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

  // ---- Filter + render ----
  function filterByRing(){
    if(!onlyWithinRing || !myRing){ filtered = featuresAll; return; }
    const c = myRing.getLatLng();
    const radiusM = kmToM(radiusKm);
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
      const status = calcOpenNowFromWeekly(p.hours?.weekly).status;
      const color = status==='open' ? '#10b981' : (status==='closed' ? '#6b7280' : '#f59e0b');

      const fid = featureId(f);
      const name = p.name || p.name_local || '(no name)';
      const cuisines = (p.sub_categories || []).join(', ');
      const price = yenBadge(p.price?.bucket);

      const marker = L.circleMarker([lat, lng], { radius: 7, weight:1, color:'#000', fillColor: color, fillOpacity:0.9 });

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
  }

  function sortFeatures(arr, key, dir){
    const cmpClosing = (A,B) => {
      const a = calcOpenNowFromWeekly(A.properties.hours?.weekly);
      const b = calcOpenNowFromWeekly(B.properties.hours?.weekly);
      const ao = a.status === 'open' ? 2 : 0;
      const bo = b.status === 'open' ? 2 : 0;
      if(bo !== ao) return bo - ao;  // open first
      const ac = Number.isFinite(a.closes_in_min) ? a.closes_in_min : 1e9;
      const bc = Number.isFinite(b.closes_in_min) ? b.closes_in_min : 1e9;
      return ac - bc; // soonest first
    };
    const cmpPrice = (A,B) => {
      const a = A.properties.sort_keys?.price_min ?? 1e9;
      const b = B.properties.sort_keys?.price_min ?? 1e9;
      return a - b; // cheap first
    };
    const cmpRatingT = (A,B) => {
      const a = parseFloat(A.properties.ratings?.tabelog?.score ?? 0) || 0;
      const b = parseFloat(B.properties.ratings?.tabelog?.score ?? 0) || 0;
      return b - a; // high first
    };
    const cmpRatingG = (A,B) => {
      const a = parseFloat(A.properties.ratings?.google?.score ?? 0) || 0;
      const b = parseFloat(B.properties.ratings?.google?.score ?? 0) || 0;
      return b - a; // high first
    };
    const cmpDistance = (A,B) => {
      const a = distanceFromUserMeters(A);
      const b = distanceFromUserMeters(B);
      return a - b; // near first
    };

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
    const list = $('#list');
    if(!list) return;
    list.innerHTML = '';
    cardIndex.clear();

    const sorted = sortFeatures(filtered, currentSort, sortDir);
    if(!sorted.length){
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:10px;color:#cbd5e1';
      msg.textContent = 'No restaurants to show. Increase the radius, select more categories, or disable the radius filter.';
      list.appendChild(msg);
      return;
    }
    sorted.forEach(f => {
      const node = renderCard(f);
      const fid = featureId(f);
      node.dataset.fid = fid;
      cardIndex.set(fid, node);
      list.appendChild(node);
    });
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

    // status pill
    const on = calcOpenNowFromWeekly(p.hours?.weekly);
    let label = 'Closed', cls='closed';
    if(on.status === 'open'){
      const parts=[];
      if (Number.isFinite(on.lo_in_min) && on.lo_in_min > 0) parts.push(`LO in ${fmtHM(on.lo_in_min)}`);
      if (Number.isFinite(on.closes_in_min)) parts.push(`Closes in ${fmtHM(on.closes_in_min)}`);
      label = parts.join(' · ') || 'Open';
      cls = (Number.isFinite(on.closes_in_min) && on.closes_in_min <= CLOSING_SOON_M) || (Number.isFinite(on.lo_in_min) && on.lo_in_min <= LO_SOON_M) ? 'soon' : 'open';
    }
    st.textContent = label;
    st.classList.add('status', cls);

    today.textContent = compactTodayFromWeekly(p.hours?.weekly);

    // chips: price / distance / subcats / policy
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

    // directions: English name ONLY
    const qName = encodeURIComponent(p.name || p.name_local || '');
    const gSearch = `https://www.google.com/maps/search/?api=1&query=${qName}`;
    if(p.urls?.tabelog){
      const a = document.createElement('a'); a.href=p.urls.tabelog; a.target='_blank'; a.rel='noopener'; a.textContent='Tabelog';
      links.appendChild(a);
    }
    const b = document.createElement('a'); b.href=gSearch; b.target='_blank'; b.rel='noopener'; b.textContent='Directions';
    links.appendChild(b);

    // click card -> fly to
    const [lng, lat] = f.geometry.coordinates;
    c.addEventListener('click', () => {
      map.flyTo([lat, lng], Math.max(MAX_ZOOM_ON_FLY, map.getZoom()));
    });

    return c;
  }

  // ---- Map → list jump ----
  function scrollToCard(fid){
    const el = cardIndex.get(fid);
    if(!el) return;
    el.classList.remove('flash'); void el.offsetWidth;
    el.classList.add('flash');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateRadiusUI(){
    const u = $('#units'), r = $('#radius'), rv = $('#radius-val');
    if(!u || !r || !rv) return;
    u.value = units;
    const disp = (units === 'mi') ? kmToMi(radiusKm) : radiusKm;
    rv.textContent = disp.toFixed(disp < 5 ? 1 : 0);
    r.min = (units === 'mi') ? '0.3' : '0.5';
    r.max = (units === 'mi') ? '6'   : '10';
    r.step = (units === 'mi') ? '0.25': '0.5';
    r.value = parseFloat(disp.toFixed(2));
  }

  // ---- Start (single-boot guard) ----
  document.addEventListener('DOMContentLoaded', () => {
    if (window.__TBLG_APP_STARTED) return;
    window.__TBLG_APP_STARTED = true;
    boot().catch(e => { console.error(e); showBanner('A runtime error occurred. Open DevTools console for details.'); });
  });

})();
