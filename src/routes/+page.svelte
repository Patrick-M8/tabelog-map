<script lang="ts">
  import { browser } from '$app/environment';
  import { createQuery } from '@tanstack/svelte-query';
  import { _ } from 'svelte-i18n';
  import { onMount } from 'svelte';

  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import PlaceCard from '$lib/components/PlaceCard.svelte';
  import {
    DEFAULT_CENTER,
    DEFAULT_RADIUS_METERS,
    RADIUS_STEPS,
    SEARCH_REDRAW_METERS
  } from '$lib/config';
  import { loadPlaceDetails, loadPlaceSummary, loadPopularHubs } from '$lib/data/client';
  import { savesStore } from '$lib/stores/saves';
  import type {
    ActiveFilters,
    DisplayPlace,
    PlaceDetail,
    PlaceSummary,
    PopularHub,
    SearchState,
    SheetSnap,
    SortKey
  } from '$lib/types';
  import { formatDistance } from '$lib/utils/format';
  import { haversineDistanceMeters, isInsideBounds, walkMinutesFromDistance } from '$lib/utils/geo';
  import { derivePlaceStatus } from '$lib/utils/hours';
  import { sortPlaces } from '$lib/utils/sort';

  const summaryQuery = createQuery<PlaceSummary[]>({
    queryKey: ['places-summary'],
    queryFn: loadPlaceSummary,
    enabled: browser
  });

  const detailQuery = createQuery<Record<string, PlaceDetail>>({
    queryKey: ['places-detail'],
    queryFn: loadPlaceDetails,
    enabled: browser
  });

  const hubQuery = createQuery<PopularHub[]>({
    queryKey: ['popular-hubs'],
    queryFn: loadPopularHubs,
    enabled: browser
  });

  const EMPTY_FILTERS: ActiveFilters = {
    openNow: false,
    closingSoon: false,
    maxWalkMinutes: null,
    priceBands: [],
    categoryKeys: []
  };

  let innerWidth = 390;
  let sheetSnap: SheetSnap = 'mid';
  let sortKey: SortKey = 'best';
  let activeFilters: ActiveFilters = { ...EMPTY_FILTERS };
  let clustersEnabled = true;
  let heatmapEnabled = false;
  let searchOpen = false;
  let filterOpen = false;
  let layersOpen = false;
  let detailOpen = false;
  let radiusMeters = DEFAULT_RADIUS_METERS;
  let selectedPlaceId: string | null = null;
  let searchInput = '';
  let searchCenter = { ...DEFAULT_CENTER };
  let mapCenter = { ...DEFAULT_CENTER };
  let mapBounds: SearchState['bounds'] = null;
  let userLocation: { lat: number; lng: number } | null = null;
  let focusTarget: { lat: number; lng: number; zoom?: number; token: string } | null = null;
  let recents: PopularHub[] = [];
  let issueToast = '';
  let geolocationDenied = false;
  let summaries: PlaceSummary[] = [];
  let details: Record<string, PlaceDetail> = {};
  let hubs: PopularHub[] = [];
  let displayPlaces: DisplayPlace[] = [];
  let sortedPlaces: DisplayPlace[] = [];
  let selectedPlace: DisplayPlace | null = null;
  let selectedDetail: PlaceDetail | null = null;
  let availableCategories: { key: string; label: string; count: number }[] = [];
  let quickCategories: { key: string; label: string; count: number }[] = [];
  let searchResults: { hubs: PopularHub[]; places: PlaceSummary[] } = { hubs: [], places: [] };
  let showRedoSearch = false;
  let desktop = false;
  let searchDriftMeters = 0;
  let MapViewComponent: typeof import('$lib/components/MapView.svelte').default | null = null;
  let DetailSheetComponent: typeof import('$lib/components/PlaceDetailSheet.svelte').default | null = null;

  const recentStorageKey = 'tabemap:recents';

  function randomToken(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function hydrateRecents() {
    if (!browser) {
      return;
    }
    const stored = localStorage.getItem(recentStorageKey);
    recents = stored ? (JSON.parse(stored) as PopularHub[]) : [];
  }

  function rememberSearch(hub: PopularHub) {
    if (!browser) {
      return;
    }
    recents = [hub, ...recents.filter((entry) => entry.id !== hub.id)].slice(0, 5);
    localStorage.setItem(recentStorageKey, JSON.stringify(recents));
  }

  function openDirections(place: PlaceSummary) {
    if (!browser) {
      return;
    }
    const url = place.placeId
      ? `https://www.google.com/maps/place/?q=place_id:${place.placeId}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${place.nameEn ?? place.nameJp ?? ''} ${place.lat},${place.lng}`
        )}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function openReserve(place: PlaceSummary) {
    if (browser && place.reserveUrl) {
      window.open(place.reserveUrl, '_blank', 'noopener,noreferrer');
    }
  }

  function openCall(place: PlaceSummary) {
    if (browser && place.callPhone) {
      window.location.href = `tel:${place.callPhone}`;
    }
  }

  function queueIssue(detail: PlaceDetail, reason: string, notes: string) {
      const payload = {
      ...detail.issuePayload,
      reason,
      notes,
      locale: browser ? navigator.language : 'en',
      submittedAt: new Date().toISOString()
    };

    if (browser) {
      const queue = JSON.parse(localStorage.getItem('tabemap:issues') ?? '[]') as unknown[];
      localStorage.setItem('tabemap:issues', JSON.stringify([payload, ...queue].slice(0, 20)));
      navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
    }

    issueToast = 'Issue payload queued locally and copied to clipboard.';
    setTimeout(() => {
      issueToast = '';
    }, 3000);
  }

  function applySearchHub(hub: PopularHub) {
    searchCenter = { lat: hub.lat, lng: hub.lng };
    mapCenter = { lat: hub.lat, lng: hub.lng };
    focusTarget = { lat: hub.lat, lng: hub.lng, zoom: 13.8, token: randomToken(hub.id) };
    rememberSearch(hub);
    searchInput = '';
    searchOpen = false;
  }

  function requestGeolocation() {
    if (!browser || !navigator.geolocation) {
      geolocationDenied = true;
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        geolocationDenied = false;
        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        searchCenter = { ...userLocation };
        mapCenter = { ...userLocation };
        focusTarget = { ...userLocation, zoom: 14.4, token: randomToken('geolocate') };
      },
      () => {
        geolocationDenied = true;
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }

  function visibleCategories(places: PlaceSummary[]) {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    for (const place of places) {
      const key = place.category.key;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { key, label: place.category.label, count: 1 });
      }
    }

    return [...counts.values()].sort((left, right) => right.count - left.count);
  }

  function toggleCategory(key: string) {
    activeFilters = {
      ...activeFilters,
      categoryKeys: activeFilters.categoryKeys.includes(key)
        ? activeFilters.categoryKeys.filter((value) => value !== key)
        : [...activeFilters.categoryKeys, key]
    };
  }

  function searchMatches(hubs: PopularHub[], places: PlaceSummary[]) {
    const query = searchInput.trim().toLowerCase();
    if (!query) {
      return {
        hubs,
        places: places.slice(0, 10)
      };
    }

    return {
      hubs: hubs.filter(
        (hub) => hub.label.toLowerCase().includes(query) || hub.nameJp.toLowerCase().includes(query)
      ),
      places: places.filter((place) =>
        `${place.nameEn ?? ''} ${place.nameJp ?? ''} ${place.station ?? ''} ${place.area ?? ''}`
          .toLowerCase()
          .includes(query)
      )
    };
  }

  function selectPlace(placeId: string) {
    selectedPlaceId = placeId;
    const place = displayPlaces.find((entry: DisplayPlace) => entry.id === placeId);
    if (place) {
      focusTarget = { lat: place.lat, lng: place.lng, zoom: 15, token: randomToken(place.id) };
      sheetSnap = 'mid';
    }
  }

  function recenter() {
    if (userLocation) {
      searchCenter = { ...userLocation };
      focusTarget = { ...userLocation, zoom: 14.4, token: randomToken('recenter') };
      return;
    }

    const hub = hubs[0];
    if (hub) {
      applySearchHub(hub);
    }
  }

  onMount(async () => {
    const [{ default: mapView }, { default: detailSheet }] = await Promise.all([
      import('$lib/components/MapView.svelte'),
      import('$lib/components/PlaceDetailSheet.svelte')
    ]);
    MapViewComponent = mapView;
    DetailSheetComponent = detailSheet;
    hydrateRecents();
    await savesStore.hydrate();
    requestGeolocation();
  });

  $: desktop = innerWidth >= 960;
  $: summaries = $summaryQuery.data ?? [];
  $: details = $detailQuery.data ?? {};
  $: hubs = $hubQuery.data ?? [];
  $: availableCategories = visibleCategories(summaries);
  $: searchResults = searchMatches(recents.length ? recents : hubs, summaries);

  $: displayPlaces = summaries
    .map((place) => {
      const anchor = searchCenter;
      const distanceMeters = haversineDistanceMeters(anchor, { lat: place.lat, lng: place.lng });
      return {
        ...place,
        distanceMeters,
        walkMinutes: walkMinutesFromDistance(distanceMeters),
        status: derivePlaceStatus(place.weeklyTimeline)
      } satisfies DisplayPlace;
    })
    .filter((place) => place.distanceMeters <= radiusMeters)
    .filter((place) => isInsideBounds({ lat: place.lat, lng: place.lng }, mapBounds))
    .filter((place) => (activeFilters.openNow ? place.status.state !== 'closed' : true))
    .filter((place) => (activeFilters.closingSoon ? place.status.state === 'closingSoon' : true))
    .filter((place) => (activeFilters.maxWalkMinutes ? place.walkMinutes <= activeFilters.maxWalkMinutes : true))
    .filter((place) => (activeFilters.priceBands.length ? activeFilters.priceBands.includes(place.priceBand ?? '') : true))
    .filter((place) => (activeFilters.categoryKeys.length ? activeFilters.categoryKeys.includes(place.category.key) : true));

  $: sortedPlaces = sortPlaces(displayPlaces, sortKey);
  $: if (!selectedPlaceId && sortedPlaces.length) {
    selectedPlaceId = sortedPlaces[0].id;
  }
  $: selectedPlace = sortedPlaces.find((place) => place.id === selectedPlaceId) ?? null;
  $: selectedDetail = selectedPlaceId ? details[selectedPlaceId] ?? null : null;
  $: searchDriftMeters = haversineDistanceMeters(searchCenter, mapCenter);
  $: showRedoSearch = searchDriftMeters > SEARCH_REDRAW_METERS;
  $: quickCategories = availableCategories.slice(0, 8);
</script>

<svelte:window bind:innerWidth />

<div class:desktop class="app-shell">
  <section class="map-region">
    {#if MapViewComponent}
      <svelte:component
        this={MapViewComponent}
        places={sortedPlaces}
        {selectedPlaceId}
        {userLocation}
        {focusTarget}
        {radiusMeters}
        {clustersEnabled}
        {heatmapEnabled}
        on:moveend={(event) => {
          mapCenter = event.detail.center;
          mapBounds = event.detail.bounds;
        }}
        on:select={(event) => selectPlace(event.detail.id)}
      />
    {:else}
      <div class="map-loading">Loading map</div>
    {/if}

    <div class="map-gradient"></div>

    <div class="top-chrome">
      <button type="button" class="search-pill" on:click={() => (searchOpen = !searchOpen)}>
        {#if geolocationDenied}
          Tokyo hubs, stations, landmarks
        {:else}
          {$_('search')}
        {/if}
      </button>
      <div class="chrome-actions">
        <button type="button" class="icon-button" on:click={() => (layersOpen = !layersOpen)}>{$_('layers')}</button>
        <button type="button" class="icon-button" on:click={recenter}>{$_('recenter')}</button>
      </div>
    </div>

    <div class="chip-row">
      <button type="button" class:active={activeFilters.openNow} on:click={() => (activeFilters = { ...activeFilters, openNow: !activeFilters.openNow })}>
        {$_('openNow')}
      </button>
      <button
        type="button"
        class:active={activeFilters.closingSoon}
        on:click={() => (activeFilters = { ...activeFilters, closingSoon: !activeFilters.closingSoon })}
      >
        {$_('closingSoon')}
      </button>
      <button
        type="button"
        class:active={activeFilters.maxWalkMinutes === 10}
        on:click={() => (activeFilters = { ...activeFilters, maxWalkMinutes: activeFilters.maxWalkMinutes === 10 ? null : 10 })}
      >
        ≤ 10 min walk
      </button>
      <button
        type="button"
        class:active={activeFilters.priceBands.includes('¥¥¥')}
        on:click={() =>
          (activeFilters = {
            ...activeFilters,
            priceBands: activeFilters.priceBands.includes('¥¥¥')
              ? activeFilters.priceBands.filter((band) => band !== '¥¥¥')
              : ['¥¥¥']
          })
        }
      >
        ¥¥¥
      </button>
      {#each quickCategories as category}
        <button type="button" class:active={activeFilters.categoryKeys.includes(category.key)} on:click={() => toggleCategory(category.key)}>
          {category.label}
        </button>
      {/each}
      <button type="button" class="ghost-chip" on:click={() => (filterOpen = true)}>{$_('filters')}</button>
    </div>

    {#if showRedoSearch}
      <button
        type="button"
        class="redo-chip"
        on:click={() => {
          searchCenter = { ...mapCenter };
          focusTarget = { ...mapCenter, token: randomToken('redo') };
        }}
      >
        {$_('searchArea')}
      </button>
    {/if}

    <div class="radius-rail" aria-label="Radius control">
      {#each RADIUS_STEPS as step}
        <button type="button" class:active={radiusMeters === step.meters} on:click={() => (radiusMeters = step.meters)}>
          {step.label}
        </button>
      {/each}
    </div>

    {#if searchOpen}
      <section class="floating-panel search-panel">
        <div class="panel-header">
          <h2>Search</h2>
          <button type="button" class="ghost-chip" on:click={() => (searchOpen = false)}>Close</button>
        </div>
        <input bind:value={searchInput} type="search" placeholder="Shinjuku, Hibiya, ramen, bakery" />
        <div class="panel-section">
          <h3>Recent</h3>
          <div class="token-wrap">
            {#each (recents.length ? recents : hubs.slice(0, 5)) as hub}
              <button type="button" on:click={() => applySearchHub(hub)}>{hub.label}</button>
            {/each}
          </div>
        </div>
        <div class="panel-section">
          <h3>Popular hubs</h3>
          <div class="search-results">
            {#each searchResults.hubs.slice(0, 6) as hub}
              <button type="button" class="result-row" on:click={() => applySearchHub(hub)}>
                <strong>{hub.label}</strong>
                <span>{hub.nameJp}</span>
              </button>
            {/each}
            {#each searchResults.places.slice(0, 8) as place}
              <button
                type="button"
                class="result-row"
                on:click={() => {
                  selectPlace(place.id);
                  searchOpen = false;
                }}
              >
                <strong>{place.nameEn ?? place.nameJp}</strong>
                <span>{place.station ?? place.area}</span>
              </button>
            {/each}
          </div>
        </div>
      </section>
    {/if}

    {#if filterOpen}
      <section class="floating-panel filter-panel">
        <div class="panel-header">
          <h2>Filters</h2>
          <button type="button" class="ghost-chip" on:click={() => (filterOpen = false)}>Close</button>
        </div>
        <div class="segment-row">
          <button type="button" class:active={sortKey === 'best'} on:click={() => (sortKey = 'best')}>{$_('sortBest')}</button>
          <button type="button" class:active={sortKey === 'closingSoon'} on:click={() => (sortKey = 'closingSoon')}>{$_('sortClosingSoon')}</button>
          <button type="button" class:active={sortKey === 'distance'} on:click={() => (sortKey = 'distance')}>{$_('sortDistance')}</button>
          <button type="button" class:active={sortKey === 'price'} on:click={() => (sortKey = 'price')}>{$_('sortPrice')}</button>
        </div>
        <div class="panel-section">
          <h3>Price</h3>
          <div class="token-wrap">
            {#each ['¥', '¥¥', '¥¥¥', '¥¥¥¥'] as band}
              <button
                type="button"
                class:active={activeFilters.priceBands.includes(band)}
                on:click={() =>
                  (activeFilters = {
                    ...activeFilters,
                    priceBands: activeFilters.priceBands.includes(band)
                      ? activeFilters.priceBands.filter((value) => value !== band)
                      : [...activeFilters.priceBands, band]
                  })
                }
              >
                {band}
              </button>
            {/each}
          </div>
        </div>
        <div class="panel-section">
          <h3>Categories</h3>
          <div class="token-wrap">
            {#each availableCategories as category}
              <button type="button" class:active={activeFilters.categoryKeys.includes(category.key)} on:click={() => toggleCategory(category.key)}>
                {category.label}
              </button>
            {/each}
          </div>
        </div>
      </section>
    {/if}

    {#if layersOpen}
      <section class="floating-panel layers-panel">
        <div class="panel-header">
          <h2>Layers</h2>
          <button type="button" class="ghost-chip" on:click={() => (layersOpen = false)}>Close</button>
        </div>
        <label class="toggle-row">
          <span>Cluster pins</span>
          <input bind:checked={clustersEnabled} type="checkbox" />
        </label>
        <label class="toggle-row">
          <span>Heatmap</span>
          <input bind:checked={heatmapEnabled} type="checkbox" />
        </label>
      </section>
    {/if}
  </section>

  {#if desktop}
    <section class="side-panel">
      <BottomSheet title="Places" snap={sheetSnap} desktop={true}>
        <div class="sheet-header">
          <div>
            <p class="eyebrow">{sortedPlaces.length} places in view</p>
            <h1>Elite picks near {selectedPlace?.station ?? 'you'}</h1>
          </div>
          <button type="button" class="ghost-chip" on:click={() => (detailOpen = !detailOpen)}>
            {detailOpen ? 'Hide details' : 'View details'}
          </button>
        </div>

        {#if issueToast}
          <div class="toast">{issueToast}</div>
        {/if}

        <div class="list-stack">
          {#if $summaryQuery.isLoading}
            {#each Array.from({ length: 6 }) as _, index (index)}
              <div class="skeleton" aria-hidden="true"></div>
            {/each}
          {:else if !sortedPlaces.length}
            <div class="empty-state">
              <h3>{geolocationDenied ? 'Choose a Tokyo hub' : 'No places in this view'}</h3>
              <p>{geolocationDenied ? 'Location is denied, so the app starts from curated hubs.' : 'Try a wider walk radius or fewer filters.'}</p>
            </div>
          {:else}
            {#each sortedPlaces as place (place.id)}
              <PlaceCard
                {place}
                selected={place.id === selectedPlaceId}
                saved={$savesStore.has(place.id)}
                on:select={() => {
                  if (selectedPlaceId === place.id) {
                    detailOpen = true;
                  }
                  selectPlace(place.id);
                }}
                on:directions={() => openDirections(place)}
                on:reserve={() => openReserve(place)}
                on:call={() => openCall(place)}
                on:save={() => savesStore.toggle(place.id)}
              />
            {/each}
          {/if}
        </div>

        {#if detailOpen && DetailSheetComponent}
          <svelte:component
            this={DetailSheetComponent}
            detail={selectedDetail}
            status={selectedPlace?.status ?? null}
            saved={selectedPlace ? $savesStore.has(selectedPlace.id) : false}
            on:close={() => (detailOpen = false)}
            on:save={(event) => savesStore.toggle(event.detail.id)}
            on:directions={(event) => {
              const place = sortedPlaces.find((item) => item.id === event.detail.id);
              if (place) openDirections(place);
            }}
            on:reserve={(event) => {
              const place = sortedPlaces.find((item) => item.id === event.detail.id);
              if (place) openReserve(place);
            }}
            on:call={(event) => {
              const place = sortedPlaces.find((item) => item.id === event.detail.id);
              if (place) openCall(place);
            }}
            on:issue={(event) => {
              if (selectedDetail) {
                queueIssue(selectedDetail, event.detail.reason, event.detail.notes);
              }
            }}
          />
        {/if}
      </BottomSheet>
    </section>
  {:else}
    <BottomSheet bind:snap={sheetSnap} title="Places">
      <div class="sheet-header">
        <div>
          <p class="eyebrow">{sortedPlaces.length} places in view</p>
          <h1>Decision in two taps</h1>
        </div>
        <button type="button" class="ghost-chip" on:click={() => (detailOpen = !detailOpen)}>
          {detailOpen ? 'List' : 'Detail'}
        </button>
      </div>

      {#if issueToast}
        <div class="toast">{issueToast}</div>
      {/if}

      {#if detailOpen && DetailSheetComponent}
        <svelte:component
          this={DetailSheetComponent}
          detail={selectedDetail}
          status={selectedPlace?.status ?? null}
          saved={selectedPlace ? $savesStore.has(selectedPlace.id) : false}
          on:close={() => (detailOpen = false)}
          on:save={(event) => savesStore.toggle(event.detail.id)}
          on:directions={(event) => {
            const place = sortedPlaces.find((item) => item.id === event.detail.id);
            if (place) openDirections(place);
          }}
          on:reserve={(event) => {
            const place = sortedPlaces.find((item) => item.id === event.detail.id);
            if (place) openReserve(place);
          }}
          on:call={(event) => {
            const place = sortedPlaces.find((item) => item.id === event.detail.id);
            if (place) openCall(place);
          }}
          on:issue={(event) => {
            if (selectedDetail) {
              queueIssue(selectedDetail, event.detail.reason, event.detail.notes);
            }
          }}
        />
      {:else if $summaryQuery.isLoading}
        {#each Array.from({ length: 4 }) as _, index (index)}
          <div class="skeleton" aria-hidden="true"></div>
        {/each}
      {:else if !sortedPlaces.length}
        <div class="empty-state">
          <h3>{geolocationDenied ? 'Choose a Tokyo hub' : 'No places in this view'}</h3>
          <p>{geolocationDenied ? 'Location is denied, so the app starts from curated hubs like Shinjuku and Ginza.' : 'Try a wider walk radius or fewer filters.'}</p>
          <div class="token-wrap">
            {#each hubs.slice(0, 5) as hub}
              <button type="button" on:click={() => applySearchHub(hub)}>{hub.label}</button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="list-stack">
          {#each sortedPlaces as place (place.id)}
            <PlaceCard
              {place}
              selected={place.id === selectedPlaceId}
              saved={$savesStore.has(place.id)}
              on:select={() => {
                if (selectedPlaceId === place.id) {
                  detailOpen = true;
                }
                selectPlace(place.id);
              }}
              on:directions={() => openDirections(place)}
              on:reserve={() => openReserve(place)}
              on:call={() => openCall(place)}
              on:save={() => savesStore.toggle(place.id)}
            />
          {/each}
        </div>
      {/if}
    </BottomSheet>
  {/if}
</div>

<style>
  .app-shell {
    position: relative;
    height: 100dvh;
    overflow: hidden;
  }

  .app-shell.desktop {
    display: grid;
    grid-template-columns: minmax(360px, 430px) 1fr;
  }

  .map-region {
    position: relative;
    min-height: 0;
  }

  .side-panel {
    position: relative;
    min-height: 0;
  }

  .map-gradient {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(246, 241, 232, 0.48) 0%, rgba(246, 241, 232, 0) 28%),
      linear-gradient(0deg, rgba(246, 241, 232, 0.58) 0%, rgba(246, 241, 232, 0) 32%);
    pointer-events: none;
    z-index: 2;
  }

  .map-loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--ink-soft);
    z-index: 1;
  }

  .top-chrome,
  .chip-row,
  .radius-rail,
  .redo-chip {
    position: absolute;
    z-index: 6;
  }

  .top-chrome {
    top: calc(16px + env(safe-area-inset-top));
    left: 16px;
    right: 16px;
    display: flex;
    gap: 10px;
  }

  .search-pill,
  .icon-button,
  .chip-row button,
  .radius-rail button,
  .ghost-chip,
  .token-wrap button,
  .segment-row button,
  .result-row {
    border: 0;
    border-radius: 999px;
    background: rgba(246, 241, 232, 0.92);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
  }

  .search-pill {
    flex: 1 1 auto;
    padding: 14px 18px;
    text-align: left;
    font-weight: 600;
  }

  .chrome-actions {
    display: flex;
    gap: 8px;
  }

  .icon-button {
    padding: 14px 16px;
    white-space: nowrap;
  }

  .chip-row {
    left: 16px;
    right: 16px;
    bottom: calc(212px + env(safe-area-inset-bottom));
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .chip-row button,
  .token-wrap button,
  .segment-row button {
    padding: 11px 14px;
    white-space: nowrap;
  }

  .chip-row button.active,
  .token-wrap button.active,
  .segment-row button.active,
  .radius-rail button.active {
    background: var(--ink);
    color: #f6f1e8;
  }

  .ghost-chip {
    padding: 11px 14px;
    background: rgba(31, 42, 47, 0.08);
  }

  .redo-chip {
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(290px + env(safe-area-inset-bottom));
    padding: 11px 16px;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: #f6f1e8;
    box-shadow: var(--shadow-strong);
  }

  .radius-rail {
    right: 16px;
    bottom: calc(214px + env(safe-area-inset-bottom));
    display: grid;
    gap: 10px;
  }

  .radius-rail button {
    width: 58px;
    padding: 10px 0;
  }

  .floating-panel {
    position: absolute;
    z-index: 10;
    top: calc(72px + env(safe-area-inset-top));
    left: 16px;
    right: 16px;
    background: var(--panel-bg);
    border-radius: 24px;
    box-shadow: var(--shadow-strong);
    padding: 16px;
    display: grid;
    gap: 14px;
    border: 1px solid var(--line);
  }

  .search-panel {
    max-height: min(70vh, 620px);
    overflow: auto;
  }

  .layers-panel {
    right: auto;
    width: min(320px, calc(100vw - 32px));
  }

  .filter-panel {
    max-height: min(72vh, 680px);
    overflow: auto;
  }

  .panel-header,
  .sheet-header,
  .toggle-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
  }

  .panel-header h2,
  .sheet-header h1,
  .panel-section h3,
  .empty-state h3 {
    margin: 0;
  }

  .sheet-header {
    align-items: start;
    margin-bottom: 14px;
  }

  .sheet-header h1 {
    font-size: clamp(1.2rem, 2.6vw, 1.7rem);
    line-height: 1.05;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: var(--ink-soft);
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .panel-section {
    display: grid;
    gap: 10px;
  }

  .search-results,
  .token-wrap,
  .segment-row,
  .list-stack {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .search-results {
    flex-direction: column;
  }

  .result-row {
    width: 100%;
    padding: 12px 14px;
    text-align: left;
    display: grid;
    gap: 4px;
  }

  input[type='search'] {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.84);
    color: var(--ink);
  }

  .list-stack {
    display: grid;
  }

  .toast,
  .empty-state,
  .skeleton {
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.76);
    border: 1px solid var(--line);
  }

  .toast,
  .empty-state {
    padding: 14px;
  }

  .empty-state {
    display: grid;
    gap: 10px;
  }

  .empty-state p {
    margin: 0;
    color: var(--ink-soft);
  }

  .skeleton {
    height: 154px;
    background:
      linear-gradient(90deg, rgba(31, 42, 47, 0.05), rgba(31, 42, 47, 0.12), rgba(31, 42, 47, 0.05));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }

  .toggle-row {
    padding: 8px 0;
  }

  @keyframes shimmer {
    from {
      background-position: 0% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @media (min-width: 960px) {
    .app-shell.desktop .map-region {
      order: 2;
    }

    .chip-row {
      bottom: calc(32px + env(safe-area-inset-bottom));
      right: 94px;
      left: 24px;
    }

    .redo-chip {
      bottom: calc(104px + env(safe-area-inset-bottom));
    }

    .radius-rail {
      bottom: calc(34px + env(safe-area-inset-bottom));
      right: 22px;
    }

    .floating-panel {
      left: 24px;
      right: auto;
      width: min(420px, calc(100vw - 40px));
    }
  }
</style>
