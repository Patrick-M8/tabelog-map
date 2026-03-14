<script lang="ts">
  import { browser } from '$app/environment';
  import { createQuery } from '@tanstack/svelte-query';
  import { _ } from 'svelte-i18n';
  import { onMount } from 'svelte';

  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import PlaceCard from '$lib/components/PlaceCard.svelte';
  import { DEFAULT_CENTER, SEARCH_REDRAW_METERS } from '$lib/config';
  import { loadPlaceDetails, loadPlaceSummary } from '$lib/data/client';
  import type { ActiveFilters, DisplayPlace, PlaceDetail, PlaceSummary, SheetSnap, SortKey } from '$lib/types';
  import { haversineDistanceMeters, isInsideBounds, walkMinutesFromDistance } from '$lib/utils/geo';
  import { derivePlaceStatus } from '$lib/utils/hours';
  import { sortPlaces } from '$lib/utils/sort';

  type SearchRecent = {
    id: string;
    label: string;
    subtitle: string;
    lat: number;
    lng: number;
  };

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

  const EMPTY_FILTERS: ActiveFilters = {
    openNow: false,
    closingSoon: false,
    maxWalkMinutes: null,
    priceBands: [],
    categoryKeys: []
  };

  const PRICE_BANDS = ['¥', '¥¥', '¥¥¥', '¥¥¥¥'];
  const RECENT_STORAGE_KEY = 'tabemap:recent-searches';

  let innerWidth = 390;
  let sheetSnap: SheetSnap = 'mid';
  let sortKey: SortKey = 'best';
  let activeFilters: ActiveFilters = { ...EMPTY_FILTERS };
  let searchOpen = false;
  let categoryMenuOpen = false;
  let priceMenuOpen = false;
  let detailOpen = false;
  let selectedPlaceId: string | null = null;
  let searchInput = '';
  let searchCenter = { ...DEFAULT_CENTER };
  let mapCenter = { ...DEFAULT_CENTER };
  let mapBounds: { north: number; south: number; east: number; west: number } | null = null;
  let userLocation: { lat: number; lng: number } | null = null;
  let focusTarget: { lat: number; lng: number; zoom?: number; token: string } | null = {
    ...DEFAULT_CENTER,
    zoom: 4.8,
    token: 'initial'
  };
  let recents: SearchRecent[] = [];
  let geolocationDenied = false;
  let summaries: PlaceSummary[] = [];
  let details: Record<string, PlaceDetail> = {};
  let candidatePlaces: DisplayPlace[] = [];
  let displayPlaces: DisplayPlace[] = [];
  let sortedPlaces: DisplayPlace[] = [];
  let visiblePlaces: DisplayPlace[] = [];
  let selectedPlace: DisplayPlace | null = null;
  let selectedDetail: PlaceDetail | null = null;
  let availableCategories: { key: string; label: string; count: number }[] = [];
  let searchResults: PlaceSummary[] = [];
  let showRedoSearch = false;
  let desktop = false;
  let MapViewComponent: typeof import('$lib/components/MapView.svelte').default | null = null;
  let DetailSheetComponent: typeof import('$lib/components/PlaceDetailSheet.svelte').default | null = null;

  function randomToken(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function hydrateRecents() {
    if (!browser) {
      return;
    }

    const stored = localStorage.getItem(RECENT_STORAGE_KEY);
    recents = stored ? (JSON.parse(stored) as SearchRecent[]) : [];
  }

  function rememberSearch(place: PlaceSummary) {
    if (!browser) {
      return;
    }

    const recent: SearchRecent = {
      id: place.id,
      label: place.nameEn ?? place.nameJp ?? 'Unknown',
      subtitle: place.station ?? place.area ?? place.category.label,
      lat: place.lat,
      lng: place.lng
    };

    recents = [recent, ...recents.filter((entry) => entry.id !== recent.id)].slice(0, 6);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recents));
  }

  function applySearchPlace(place: PlaceSummary) {
    searchCenter = { lat: place.lat, lng: place.lng };
    mapCenter = { lat: place.lat, lng: place.lng };
    focusTarget = { lat: place.lat, lng: place.lng, zoom: 14.8, token: randomToken(place.id) };
    rememberSearch(place);
    selectPlace(place.id, false);
    searchInput = '';
    searchOpen = false;
    detailOpen = false;
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
        focusTarget = { ...DEFAULT_CENTER, zoom: 4.8, token: randomToken('japan-default') };
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

  function togglePriceBand(band: string) {
    activeFilters = {
      ...activeFilters,
      priceBands: activeFilters.priceBands.includes(band)
        ? activeFilters.priceBands.filter((value) => value !== band)
        : [...activeFilters.priceBands, band]
    };
  }

  function selectPlace(placeId: string, refocus = true) {
    selectedPlaceId = placeId;
    const place = candidatePlaces.find((entry) => entry.id === placeId) ?? summaries.find((entry) => entry.id === placeId);
    if (place && refocus) {
      focusTarget = { lat: place.lat, lng: place.lng, zoom: 15, token: randomToken(place.id) };
      sheetSnap = 'mid';
    }
  }

  function recenter() {
    if (userLocation) {
      searchCenter = { ...userLocation };
      mapCenter = { ...userLocation };
      focusTarget = { ...userLocation, zoom: 14.4, token: randomToken('recenter') };
      return;
    }

    focusTarget = { ...DEFAULT_CENTER, zoom: 4.8, token: randomToken('reset-japan') };
    searchCenter = { ...DEFAULT_CENTER };
    mapCenter = { ...DEFAULT_CENTER };
  }

  function searchMatches(places: PlaceSummary[]) {
    const query = searchInput.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return places
      .filter((place) =>
        `${place.nameEn ?? ''} ${place.nameJp ?? ''} ${place.station ?? ''} ${place.area ?? ''} ${place.category.label} ${(place.subCategories ?? []).join(' ')}`
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 24);
  }

  onMount(async () => {
    const [{ default: mapView }, { default: detailSheet }] = await Promise.all([
      import('$lib/components/MapView.svelte'),
      import('$lib/components/PlaceDetailSheet.svelte')
    ]);
    MapViewComponent = mapView;
    DetailSheetComponent = detailSheet;
    hydrateRecents();
    requestGeolocation();
  });

  $: desktop = innerWidth >= 960;
  $: summaries = $summaryQuery.data ?? [];
  $: details = $detailQuery.data ?? {};
  $: availableCategories = visibleCategories(summaries);
  $: searchResults = searchMatches(summaries);
  $: candidatePlaces = summaries
    .map((place) => {
      const distanceMeters = haversineDistanceMeters(searchCenter, { lat: place.lat, lng: place.lng });
      return {
        ...place,
        distanceMeters,
        walkMinutes: walkMinutesFromDistance(distanceMeters),
        status: derivePlaceStatus(place.weeklyTimeline)
      } satisfies DisplayPlace;
    })
    .filter((place) => (activeFilters.openNow ? place.status.state !== 'closed' : true))
    .filter((place) => (activeFilters.maxWalkMinutes ? place.walkMinutes <= activeFilters.maxWalkMinutes : true))
    .filter((place) => (activeFilters.priceBands.length ? activeFilters.priceBands.includes(place.priceBand ?? '') : true))
    .filter((place) => (activeFilters.categoryKeys.length ? activeFilters.categoryKeys.includes(place.category.key) : true));
  $: displayPlaces = candidatePlaces.filter((place) => isInsideBounds({ lat: place.lat, lng: place.lng }, mapBounds));
  $: sortedPlaces = sortPlaces(displayPlaces, sortKey);
  $: if (sortedPlaces.length && !sortedPlaces.some((place) => place.id === selectedPlaceId)) {
    selectedPlaceId = sortedPlaces[0].id;
  }
  $: if (!sortedPlaces.length) {
    selectedPlaceId = null;
    detailOpen = false;
  }
  $: selectedPlace = sortedPlaces.find((place) => place.id === selectedPlaceId) ?? null;
  $: selectedDetail = selectedPlaceId ? details[selectedPlaceId] ?? null : null;
  $: showRedoSearch = haversineDistanceMeters(searchCenter, mapCenter) > SEARCH_REDRAW_METERS;
  $: {
    const firstChunk = sortedPlaces.slice(0, 80);
    if (selectedPlace && !firstChunk.some((place) => place.id === selectedPlace.id)) {
      visiblePlaces = [selectedPlace, ...firstChunk.slice(0, 79)];
    } else {
      visiblePlaces = firstChunk;
    }
  }
</script>

<svelte:window bind:innerWidth />

<div class:desktop class="app-shell">
  <section class="map-region">
    {#if MapViewComponent}
      <svelte:component
        this={MapViewComponent}
        places={candidatePlaces}
        {selectedPlaceId}
        {userLocation}
        {focusTarget}
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
        {$_('search')}
      </button>
      <button type="button" class="icon-button" on:click={recenter}>{$_('recenter')}</button>
    </div>

    <div class="chip-row">
      <button type="button" class:active={activeFilters.openNow} on:click={() => (activeFilters = { ...activeFilters, openNow: !activeFilters.openNow })}>
        Open
      </button>
      <button
        type="button"
        class:active={activeFilters.maxWalkMinutes === 10}
        on:click={() => (activeFilters = { ...activeFilters, maxWalkMinutes: activeFilters.maxWalkMinutes === 10 ? null : 10 })}
      >
        &lt;= 10 min walk
      </button>
      <button type="button" class:active={activeFilters.categoryKeys.length > 0} on:click={() => {
        categoryMenuOpen = !categoryMenuOpen;
        priceMenuOpen = false;
      }}>
        Categories
      </button>
      <button type="button" class:active={activeFilters.priceBands.length > 0} on:click={() => {
        priceMenuOpen = !priceMenuOpen;
        categoryMenuOpen = false;
      }}>
        Price
      </button>
    </div>

    {#if categoryMenuOpen}
      <section class="chip-panel chip-panel-left">
        <div class="chip-panel-header">
          <h2>Categories</h2>
          <button type="button" class="ghost-chip" on:click={() => (categoryMenuOpen = false)}>Close</button>
        </div>
        <div class="token-wrap">
          {#each availableCategories as category}
            <button type="button" class:active={activeFilters.categoryKeys.includes(category.key)} on:click={() => toggleCategory(category.key)}>
              {category.label}
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if priceMenuOpen}
      <section class="chip-panel chip-panel-right">
        <div class="chip-panel-header">
          <h2>Price</h2>
          <button type="button" class="ghost-chip" on:click={() => (priceMenuOpen = false)}>Close</button>
        </div>
        <div class="token-wrap">
          {#each PRICE_BANDS as band}
            <button type="button" class:active={activeFilters.priceBands.includes(band)} on:click={() => togglePriceBand(band)}>
              {band}
            </button>
          {/each}
        </div>
      </section>
    {/if}

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

    {#if searchOpen}
      <section class="floating-panel search-panel">
        <div class="panel-header">
          <h2>Search across Japan</h2>
          <button type="button" class="ghost-chip" on:click={() => (searchOpen = false)}>Close</button>
        </div>
        <input bind:value={searchInput} type="search" placeholder="Search any restaurant, station, area, or cuisine" />
        {#if recents.length > 0}
          <div class="panel-section">
            <h3>Recent searches</h3>
            <div class="token-wrap">
              {#each recents as recent}
                <button
                  type="button"
                  on:click={() => {
                    searchCenter = { lat: recent.lat, lng: recent.lng };
                    mapCenter = { lat: recent.lat, lng: recent.lng };
                    focusTarget = { lat: recent.lat, lng: recent.lng, zoom: 14.8, token: randomToken(recent.id) };
                    searchOpen = false;
                  }}
                >
                  {recent.label}
                </button>
              {/each}
            </div>
          </div>
        {/if}
        <div class="panel-section">
          <h3>Results</h3>
          <div class="search-results">
            {#if searchInput.trim().length === 0}
              <div class="empty-search">Start typing to search all restaurants in Japan.</div>
            {:else if searchResults.length === 0}
              <div class="empty-search">No matches found.</div>
            {:else}
              {#each searchResults as place}
                <button type="button" class="result-row" on:click={() => applySearchPlace(place)}>
                  <strong>{place.nameEn ?? place.nameJp}</strong>
                  <span>{place.station ?? place.area ?? place.category.label}</span>
                </button>
              {/each}
            {/if}
          </div>
        </div>
      </section>
    {/if}
  </section>

  {#if desktop}
    <section class="side-panel">
      <BottomSheet title="Places" snap={sheetSnap} desktop={true}>
        <div class="sheet-header">
          <div>
            <p class="eyebrow">{sortedPlaces.length} places in view</p>
            <h1>{selectedPlace?.station ?? 'Restaurants across Japan'}</h1>
          </div>
          <div class="segment-row">
            <button type="button" class:active={sortKey === 'best'} on:click={() => (sortKey = 'best')}>Best nearby</button>
            <button type="button" class:active={sortKey === 'distance'} on:click={() => (sortKey = 'distance')}>Distance</button>
            <button type="button" class:active={sortKey === 'price'} on:click={() => (sortKey = 'price')}>Price</button>
          </div>
        </div>

        {#if detailOpen && DetailSheetComponent}
          <svelte:component
            this={DetailSheetComponent}
            detail={selectedDetail}
            status={selectedPlace?.status ?? null}
            on:close={() => (detailOpen = false)}
            on:directions={(event) => {
              const place = sortedPlaces.find((item) => item.id === event.detail.id);
              if (place) openDirections(place);
            }}
            on:reserve={(event) => {
              const place = sortedPlaces.find((item) => item.id === event.detail.id);
              if (place) openReserve(place);
            }}
          />
        {:else if $summaryQuery.isLoading}
          {#each Array.from({ length: 6 }) as _, index (index)}
            <div class="skeleton" aria-hidden="true"></div>
          {/each}
        {:else if !sortedPlaces.length}
          <div class="empty-state">
            <h3>No places in this view</h3>
            <p>Pan, zoom, or search to another area in Japan.</p>
          </div>
        {:else}
          {#if sortedPlaces.length > visiblePlaces.length}
            <div class="result-limit">Showing {visiblePlaces.length} of {sortedPlaces.length} places in the current viewport.</div>
          {/if}
          <div class="list-stack">
            {#each visiblePlaces as place (place.id)}
              <PlaceCard
                {place}
                selected={place.id === selectedPlaceId}
                on:select={() => {
                  if (selectedPlaceId === place.id) {
                    detailOpen = true;
                  }
                  selectPlace(place.id);
                }}
                on:directions={() => openDirections(place)}
                on:reserve={() => openReserve(place)}
              />
            {/each}
          </div>
        {/if}
      </BottomSheet>
    </section>
  {:else}
    <BottomSheet bind:snap={sheetSnap} title="Places">
      <div class="sheet-header">
        <div>
          <p class="eyebrow">{sortedPlaces.length} places in view</p>
          <h1>Restaurants in the current map view</h1>
        </div>
        <button type="button" class="ghost-chip" on:click={() => (detailOpen = !detailOpen)}>{detailOpen ? 'List' : 'Detail'}</button>
      </div>

      <div class="segment-row segment-row-mobile">
        <button type="button" class:active={sortKey === 'best'} on:click={() => (sortKey = 'best')}>Best nearby</button>
        <button type="button" class:active={sortKey === 'distance'} on:click={() => (sortKey = 'distance')}>Distance</button>
        <button type="button" class:active={sortKey === 'price'} on:click={() => (sortKey = 'price')}>Price</button>
      </div>

      {#if detailOpen && DetailSheetComponent}
        <svelte:component
          this={DetailSheetComponent}
          detail={selectedDetail}
          status={selectedPlace?.status ?? null}
          on:close={() => (detailOpen = false)}
          on:directions={(event) => {
            const place = sortedPlaces.find((item) => item.id === event.detail.id);
            if (place) openDirections(place);
          }}
          on:reserve={(event) => {
            const place = sortedPlaces.find((item) => item.id === event.detail.id);
            if (place) openReserve(place);
          }}
        />
      {:else if $summaryQuery.isLoading}
        {#each Array.from({ length: 4 }) as _, index (index)}
          <div class="skeleton" aria-hidden="true"></div>
        {/each}
      {:else if !sortedPlaces.length}
        <div class="empty-state">
          <h3>No places in this view</h3>
          <p>Pan, zoom, or search to another area in Japan.</p>
        </div>
      {:else}
        {#if sortedPlaces.length > visiblePlaces.length}
          <div class="result-limit">Showing {visiblePlaces.length} of {sortedPlaces.length} places in the current viewport.</div>
        {/if}
        <div class="list-stack">
          {#each visiblePlaces as place (place.id)}
            <PlaceCard
              {place}
              selected={place.id === selectedPlaceId}
              on:select={() => {
                if (selectedPlaceId === place.id) {
                  detailOpen = true;
                }
                selectPlace(place.id);
              }}
              on:directions={() => openDirections(place)}
              on:reserve={() => openReserve(place)}
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
  .redo-chip,
  .chip-panel {
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
  .segment-row button.active {
    background: var(--ink);
    color: #f6f1e8;
  }

  .ghost-chip {
    padding: 11px 14px;
    background: rgba(31, 42, 47, 0.08);
  }

  .chip-panel {
    bottom: calc(266px + env(safe-area-inset-bottom));
    width: min(340px, calc(100vw - 32px));
    background: var(--panel-bg);
    border-radius: 22px;
    box-shadow: var(--shadow-strong);
    padding: 14px;
    display: grid;
    gap: 12px;
  }

  .chip-panel-left {
    left: 16px;
  }

  .chip-panel-right {
    right: 16px;
  }

  .chip-panel-header,
  .panel-header,
  .sheet-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
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
    max-height: min(72vh, 680px);
    overflow: auto;
  }

  .sheet-header {
    align-items: start;
    margin-bottom: 14px;
  }

  .sheet-header h1,
  .panel-header h2,
  .chip-panel-header h2 {
    margin: 0;
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

  .panel-section,
  .search-results,
  .token-wrap,
  .segment-row,
  .list-stack {
    display: grid;
    gap: 10px;
  }

  .token-wrap {
    display: flex;
    flex-wrap: wrap;
  }

  .segment-row {
    display: flex;
    flex-wrap: wrap;
  }

  .segment-row-mobile {
    margin-bottom: 14px;
  }

  .search-results {
    gap: 8px;
  }

  .result-row {
    width: 100%;
    padding: 12px 14px;
    text-align: left;
    display: grid;
    gap: 4px;
  }

  .empty-search,
  .result-limit,
  .empty-state,
  .skeleton {
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.76);
    border: 1px solid var(--line);
  }

  .empty-search,
  .result-limit,
  .empty-state {
    padding: 14px;
    color: var(--ink-soft);
  }

  .empty-state {
    display: grid;
    gap: 10px;
  }

  .empty-state h3,
  .empty-state p {
    margin: 0;
  }

  .list-stack {
    display: grid;
  }

  input[type='search'] {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.84);
    color: var(--ink);
  }

  .skeleton {
    height: 154px;
    background:
      linear-gradient(90deg, rgba(31, 42, 47, 0.05), rgba(31, 42, 47, 0.12), rgba(31, 42, 47, 0.05));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
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
      right: 24px;
      left: 24px;
    }

    .chip-panel {
      bottom: calc(94px + env(safe-area-inset-bottom));
    }

    .redo-chip {
      bottom: calc(110px + env(safe-area-inset-bottom));
    }

    .floating-panel {
      left: 24px;
      right: auto;
      width: min(460px, calc(100vw - 40px));
    }
  }
</style>
