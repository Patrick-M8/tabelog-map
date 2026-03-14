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
  import { formatDistance, formatPriceBand, formatPriceRange, normalizePriceBand } from '$lib/utils/format';
  import { haversineDistanceMeters, isInsideBounds, walkMinutesFromDistance } from '$lib/utils/geo';
  import { derivePlaceStatus } from '$lib/utils/hours';
  import { countActiveFilters, summarizeFilters } from '$lib/utils/discovery';
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

  const PRICE_BANDS = Array.from({ length: 5 }, (_, index) => '\u00A5'.repeat(index + 1));
  const WALK_MINUTE_OPTIONS = [5, 10, 15, 30];
  const RECENT_STORAGE_KEY = 'tabemap:recent-searches';

  let innerWidth = 390;
  let sheetSnap: SheetSnap = 'peek';
  let sortKey: SortKey = 'best';
  let activeFilters: ActiveFilters = { ...EMPTY_FILTERS };
  let searchOpen = false;
  let filterOpen = false;
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
  let mobileListPlaces: DisplayPlace[] = [];
  let selectedPlace: DisplayPlace | null = null;
  let selectedDetail: PlaceDetail | null = null;
  let availableCategories: { key: string; label: string; count: number }[] = [];
  let searchResults: PlaceSummary[] = [];
  let showRedoSearch = false;
  let desktop = false;
  let activeFilterCount = 0;
  let filterSummary = 'All nearby';
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

  function priceSortAriaLabel() {
    return sortKey === 'priceDesc' ? 'Price descending' : 'Price ascending';
  }

  function togglePriceSort() {
    sortKey = sortKey === 'priceAsc' ? 'priceDesc' : 'priceAsc';
  }

  function setWalkMinutes(minutes: number) {
    activeFilters = {
      ...activeFilters,
      maxWalkMinutes: activeFilters.maxWalkMinutes === minutes ? null : minutes
    };
  }

  function toggleSearch() {
    searchOpen = !searchOpen;
    filterOpen = false;
    detailOpen = false;
  }

  function openFilters() {
    filterOpen = true;
    searchOpen = false;
    detailOpen = false;
    if (!desktop) {
      sheetSnap = 'full';
    }
  }

  function closeFilters() {
    filterOpen = false;
  }

  function clearFilters() {
    activeFilters = { ...EMPTY_FILTERS };
  }

  function openDetail() {
    if (!selectedPlaceId) {
      return;
    }

    detailOpen = true;
    filterOpen = false;
    searchOpen = false;
    if (!desktop) {
      sheetSnap = 'full';
    }
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
    filterOpen = false;
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
    detailOpen = false;
    filterOpen = false;

    const place =
      candidatePlaces.find((entry) => entry.id === placeId) ?? summaries.find((entry) => entry.id === placeId);
    if (place && refocus) {
      focusTarget = { lat: place.lat, lng: place.lng, zoom: 15, token: randomToken(place.id) };
      if (!desktop) {
        sheetSnap = 'mid';
      }
    }
  }

  function handlePlaceSelect(placeId: string) {
    if (selectedPlaceId === placeId) {
      openDetail();
      return;
    }

    selectPlace(placeId);
  }

  function useUserLocation() {
    if (userLocation) {
      searchCenter = { ...userLocation };
      mapCenter = { ...userLocation };
      focusTarget = { ...userLocation, zoom: 14.4, token: randomToken('recenter') };
      return;
    }

    requestGeolocation();
    if (!geolocationDenied) {
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
  $: activeFilterCount = countActiveFilters(activeFilters);
  $: filterSummary = summarizeFilters(activeFilters);
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
    .filter((place) => (activeFilters.closingSoon ? place.status.state === 'closingSoon' : true))
    .filter((place) => (activeFilters.maxWalkMinutes ? place.walkMinutes <= activeFilters.maxWalkMinutes : true))
    .filter((place) =>
      activeFilters.priceBands.length
        ? activeFilters.priceBands.includes(normalizePriceBand(place.priceBand, place.priceBucket) ?? '')
        : true
    )
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
  $: mobileListPlaces = selectedPlace ? visiblePlaces.filter((place) => place.id !== selectedPlace.id) : visiblePlaces;
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
        {desktop}
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
      <button type="button" class="search-pill" on:click={toggleSearch}>
        <span class="search-pill-title">{$_('search')}</span>
        <small>Stations, areas, landmarks</small>
      </button>

      <div class="top-actions">
        <button
          type="button"
          class="icon-button filter-button"
          aria-label={activeFilterCount > 0 ? `Open filters, ${activeFilterCount} active` : 'Open filters'}
          on:click={openFilters}
        >
          <span>Filter</span>
          {#if activeFilterCount > 0}
            <strong>{activeFilterCount}</strong>
          {/if}
        </button>

        <button type="button" class="icon-button icon-button-square" aria-label="Use my location" on:click={useUserLocation}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 2a6 6 0 0 0-6 6c0 4.26 6 12 6 12s6-7.74 6-12a6 6 0 0 0-6-6Zm0 8.5A2.5 2.5 0 1 1 12 5a2.5 2.5 0 0 1 0 5.5Z"
            />
          </svg>
        </button>
      </div>
    </div>

    {#if showRedoSearch}
      <button
        type="button"
        class="viewport-chip"
        on:click={() => {
          searchCenter = { ...mapCenter };
          focusTarget = { ...mapCenter, token: randomToken('redo') };
        }}
      >
        {$_('searchArea')}
      </button>
    {/if}

    {#if searchOpen}
      <button type="button" class="panel-scrim" aria-label="Close search" on:click={() => (searchOpen = false)}></button>

      <section class="floating-panel search-panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Discover</p>
            <h2>Search across Japan</h2>
          </div>
          <button type="button" class="ghost-chip ghost-chip-icon" aria-label="Close search" on:click={() => (searchOpen = false)}>
            <span aria-hidden="true">x</span>
          </button>
        </div>

        <input bind:value={searchInput} type="search" placeholder="Search any restaurant, station, area, or cuisine" />

        {#if recents.length > 0}
          <div class="panel-section">
            <div class="section-heading">
              <h3>Recent searches</h3>
            </div>
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
          <div class="section-heading">
            <h3>Results</h3>
          </div>
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

    {#if filterOpen && desktop}
      <button type="button" class="panel-scrim" aria-label="Close filters" on:click={closeFilters}></button>

      <section class="floating-panel filter-panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Refine</p>
            <h2>Filters</h2>
          </div>
          <button type="button" class="ghost-chip ghost-chip-icon" aria-label="Close filters" on:click={closeFilters}>
            <span aria-hidden="true">x</span>
          </button>
        </div>

        <p class="filter-summary">{filterSummary}</p>

        <section class="filter-section">
          <div class="section-heading">
            <h3>Availability</h3>
            {#if activeFilters.openNow || activeFilters.closingSoon}
              <button type="button" class="text-button" on:click={() => (activeFilters = { ...activeFilters, openNow: false, closingSoon: false })}>
                Reset
              </button>
            {/if}
          </div>
          <div class="token-wrap">
            <button type="button" class:active={activeFilters.openNow} on:click={() => (activeFilters = { ...activeFilters, openNow: !activeFilters.openNow })}>
              Open now
            </button>
            <button
              type="button"
              class:active={activeFilters.closingSoon}
              on:click={() => (activeFilters = { ...activeFilters, closingSoon: !activeFilters.closingSoon })}
            >
              Closing soon
            </button>
          </div>
        </section>

        <section class="filter-section">
          <div class="section-heading">
            <h3>Walk time</h3>
          </div>
          <div class="token-wrap">
            {#each WALK_MINUTE_OPTIONS as minutes}
              <button type="button" class:active={activeFilters.maxWalkMinutes === minutes} on:click={() => setWalkMinutes(minutes)}>
                &lt;= {minutes} min
              </button>
            {/each}
          </div>
        </section>

        <section class="filter-section">
          <div class="section-heading">
            <h3>Price</h3>
          </div>
          <div class="token-wrap">
            {#each PRICE_BANDS as band}
              <button type="button" class:active={activeFilters.priceBands.includes(band)} on:click={() => togglePriceBand(band)}>
                <span class="filter-token">
                  <strong>{band}</strong>
                  <small>{formatPriceRange(band)}</small>
                </span>
              </button>
            {/each}
          </div>
        </section>

        <section class="filter-section">
          <div class="section-heading">
            <h3>Cuisine</h3>
          </div>
          <div class="token-wrap token-wrap-categories">
            {#each availableCategories as category}
              <button type="button" class:active={activeFilters.categoryKeys.includes(category.key)} on:click={() => toggleCategory(category.key)}>
                {category.label}
              </button>
            {/each}
          </div>
        </section>

        <div class="filter-footer">
          <button type="button" class="ghost-chip" on:click={clearFilters}>Clear all</button>
          <button type="button" class="primary-button" on:click={closeFilters}>Show {sortedPlaces.length} places</button>
        </div>
      </section>
    {/if}
  </section>

  {#if desktop}
    <section class="side-panel">
      <BottomSheet title={detailOpen ? 'Place details' : 'Places'} snap={sheetSnap} desktop={true}>
        {#if detailOpen && DetailSheetComponent}
          {#if selectedDetail}
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
          {:else}
            <div class="empty-state">
              <h3>Loading details</h3>
              <p>Restaurant detail is being prepared.</p>
            </div>
          {/if}
        {:else}
          <div class="sheet-header">
            <div>
              <p class="eyebrow">{sortedPlaces.length} places in view</p>
              <h1>{selectedPlace?.station ?? 'Restaurants near the current map'}</h1>
              <p class="sheet-summary">{filterSummary}</p>
            </div>
            <button type="button" class="ghost-chip" on:click={openFilters}>
              Filters{#if activeFilterCount > 0} {activeFilterCount}{/if}
            </button>
          </div>

          <div class="segment-row">
            <button type="button" class:active={sortKey === 'best'} on:click={() => (sortKey = 'best')}>Best nearby</button>
            <button type="button" class:active={sortKey === 'distance'} on:click={() => (sortKey = 'distance')}>Nearest</button>
            <button
              type="button"
              aria-label={priceSortAriaLabel()}
              class:active={sortKey === 'priceAsc' || sortKey === 'priceDesc'}
              on:click={togglePriceSort}
            >
              Price <span aria-hidden="true">{#if sortKey === 'priceDesc'}v{:else}^{/if}</span>
            </button>
          </div>

          {#if $summaryQuery.isLoading}
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
                  imageUrl={details[place.id]?.imageUrl ?? null}
                  selected={place.id === selectedPlaceId}
                  on:select={() => handlePlaceSelect(place.id)}
                  on:directions={() => openDirections(place)}
                  on:reserve={() => openReserve(place)}
                />
              {/each}
            </div>
          {/if}
        {/if}
      </BottomSheet>
    </section>
  {:else}
    <BottomSheet bind:snap={sheetSnap} title={filterOpen ? 'Filters' : detailOpen ? 'Place details' : 'Places'}>
      {#if filterOpen}
        <div class="sheet-header">
          <div>
            <p class="eyebrow">Refine</p>
            <h1>Filters</h1>
            <p class="sheet-summary">{filterSummary}</p>
          </div>
          <button type="button" class="ghost-chip" on:click={closeFilters}>Done</button>
        </div>

        <section class="filter-section">
          <div class="section-heading">
            <h3>Availability</h3>
          </div>
          <div class="token-wrap">
            <button type="button" class:active={activeFilters.openNow} on:click={() => (activeFilters = { ...activeFilters, openNow: !activeFilters.openNow })}>
              Open now
            </button>
            <button
              type="button"
              class:active={activeFilters.closingSoon}
              on:click={() => (activeFilters = { ...activeFilters, closingSoon: !activeFilters.closingSoon })}
            >
              Closing soon
            </button>
          </div>
        </section>

        <section class="filter-section">
          <div class="section-heading">
            <h3>Walk time</h3>
          </div>
          <div class="token-wrap">
            {#each WALK_MINUTE_OPTIONS as minutes}
              <button type="button" class:active={activeFilters.maxWalkMinutes === minutes} on:click={() => setWalkMinutes(minutes)}>
                &lt;= {minutes} min
              </button>
            {/each}
          </div>
        </section>

        <section class="filter-section">
          <div class="section-heading">
            <h3>Price</h3>
          </div>
          <div class="token-wrap">
            {#each PRICE_BANDS as band}
              <button type="button" class:active={activeFilters.priceBands.includes(band)} on:click={() => togglePriceBand(band)}>
                <span class="filter-token">
                  <strong>{band}</strong>
                  <small>{formatPriceRange(band)}</small>
                </span>
              </button>
            {/each}
          </div>
        </section>

        <section class="filter-section">
          <div class="section-heading">
            <h3>Cuisine</h3>
          </div>
          <div class="token-wrap token-wrap-categories">
            {#each availableCategories as category}
              <button type="button" class:active={activeFilters.categoryKeys.includes(category.key)} on:click={() => toggleCategory(category.key)}>
                {category.label}
              </button>
            {/each}
          </div>
        </section>

        <div class="filter-footer">
          <button type="button" class="ghost-chip" on:click={clearFilters}>Clear all</button>
          <button type="button" class="primary-button" on:click={closeFilters}>Show {sortedPlaces.length} places</button>
        </div>
      {:else if detailOpen && DetailSheetComponent}
        {#if selectedDetail}
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
        {:else}
          <div class="empty-state">
            <h3>Loading details</h3>
            <p>Restaurant detail is being prepared.</p>
          </div>
        {/if}
      {:else}
        <div class="sheet-header">
          <div>
            <p class="eyebrow">{sortedPlaces.length} places in view</p>
            <h1>Restaurants nearby</h1>
            <p class="sheet-summary">{filterSummary}</p>
          </div>
          <button type="button" class="ghost-chip" on:click={openFilters}>
            Filters{#if activeFilterCount > 0} {activeFilterCount}{/if}
          </button>
        </div>

        {#if selectedPlace}
          <button type="button" class="selection-hero" on:click={openDetail}>
            <div class="selection-media">
              {#if selectedDetail?.imageUrl}
                <img src={selectedDetail.imageUrl} alt={selectedPlace.nameEn ?? selectedPlace.nameJp ?? 'Restaurant'} loading="lazy" />
              {:else}
                <div class="selection-placeholder">Selected place</div>
              {/if}
            </div>

            <div class="selection-copy">
              <div class="selection-topline">
                <span class={`status-pill ${selectedPlace.status.state}`}>{selectedPlace.status.label}</span>
                <span>{selectedPlace.walkMinutes} min walk</span>
              </div>
              <h2>{selectedPlace.nameEn ?? selectedPlace.nameJp}</h2>
              <p>{selectedPlace.category.label} · {selectedPlace.station ?? selectedPlace.area ?? 'Japan'}</p>
              <div class="selection-metrics">
                <span>Tabelog {selectedPlace.tabelog.score ?? '-'}</span>
                <span>{formatPriceBand(selectedPlace.priceBand, selectedPlace.priceBucket)}</span>
                <span>{formatDistance(selectedPlace.distanceMeters)}</span>
              </div>
              <small>{selectedPlace.status.detail}</small>
            </div>

            <span class="selection-cta">View</span>
          </button>
        {/if}

        <div class="segment-row segment-row-mobile">
          <button type="button" class:active={sortKey === 'best'} on:click={() => (sortKey = 'best')}>Best nearby</button>
          <button type="button" class:active={sortKey === 'distance'} on:click={() => (sortKey = 'distance')}>Nearest</button>
          <button
            type="button"
            aria-label={priceSortAriaLabel()}
            class:active={sortKey === 'priceAsc' || sortKey === 'priceDesc'}
            on:click={togglePriceSort}
          >
            Price <span aria-hidden="true">{#if sortKey === 'priceDesc'}v{:else}^{/if}</span>
          </button>
        </div>

        {#if $summaryQuery.isLoading}
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
            {#each mobileListPlaces as place (place.id)}
              <PlaceCard
                {place}
                imageUrl={details[place.id]?.imageUrl ?? null}
                selected={place.id === selectedPlaceId}
                on:select={() => handlePlaceSelect(place.id)}
                on:directions={() => openDirections(place)}
                on:reserve={() => openReserve(place)}
              />
            {/each}
          </div>
        {/if}
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
    grid-template-columns: minmax(380px, 430px) 1fr;
  }

  .map-region {
    position: relative;
    height: 100%;
    min-height: 0;
  }

  .side-panel {
    position: relative;
    height: 100%;
    min-height: 0;
  }

  .map-gradient {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(247, 246, 243, 0.24) 0%, rgba(247, 246, 243, 0) 18%),
      linear-gradient(0deg, rgba(247, 246, 243, 0.14) 0%, rgba(247, 246, 243, 0) 20%);
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
  .viewport-chip,
  .floating-panel,
  .panel-scrim {
    position: absolute;
    z-index: 24;
  }

  .top-chrome {
    top: calc(14px + env(safe-area-inset-top));
    left: 14px;
    right: 14px;
    display: flex;
    gap: 10px;
    align-items: start;
  }

  .search-pill,
  .icon-button,
  .ghost-chip,
  .token-wrap button,
  .segment-row button,
  .result-row,
  .primary-button {
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.88);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
  }

  .search-pill {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    gap: 2px;
    text-align: left;
    padding: 14px 16px;
    backdrop-filter: blur(12px);
  }

  .search-pill-title {
    font-weight: 700;
  }

  .search-pill small {
    color: var(--ink-soft);
    font-size: 0.78rem;
  }

  .top-actions {
    display: flex;
    gap: 10px;
  }

  .icon-button {
    min-height: 52px;
    padding: 0 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-weight: 600;
    backdrop-filter: blur(12px);
  }

  .icon-button-square {
    width: 52px;
    padding: 0;
    flex: 0 0 auto;
  }

  .icon-button svg {
    width: 22px;
    height: 22px;
    fill: currentColor;
  }

  .filter-button strong {
    min-width: 24px;
    height: 24px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--ink);
    color: #f8f7f4;
    font-size: 0.76rem;
  }

  .viewport-chip {
    top: calc(82px + env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    padding: 11px 16px;
    border: 0;
    border-radius: 999px;
    background: #17191c;
    color: #f8f7f4;
    box-shadow: var(--shadow-strong);
  }

  .panel-scrim {
    inset: 0;
    border: 0;
    background: rgba(17, 24, 39, 0.16);
  }

  .floating-panel {
    left: 14px;
    right: 14px;
    top: calc(78px + env(safe-area-inset-top));
    background: rgba(247, 246, 243, 0.96);
    backdrop-filter: blur(18px);
    border-radius: 28px;
    box-shadow: var(--shadow-strong);
    padding: 16px;
    display: grid;
    gap: 16px;
    border: 1px solid rgba(255, 255, 255, 0.7);
    z-index: 30;
  }

  .search-panel {
    max-height: min(72vh, 720px);
    overflow: auto;
  }

  .filter-panel {
    width: min(420px, calc(100vw - 28px));
    right: auto;
    max-height: min(78vh, 760px);
    overflow: auto;
  }

  .panel-header,
  .sheet-header,
  .section-heading,
  .filter-footer {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
  }

  .sheet-header {
    align-items: start;
    margin-bottom: 14px;
  }

  .sheet-header h1,
  .panel-header h2,
  .section-heading h3 {
    margin: 0;
  }

  .sheet-header h1 {
    font-size: clamp(1.18rem, 3vw, 1.6rem);
    line-height: 1.08;
  }

  .sheet-summary,
  .filter-summary {
    margin: 6px 0 0;
    color: var(--ink-soft);
  }

  .eyebrow {
    margin: 0 0 6px;
    color: rgba(23, 25, 28, 0.56);
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .ghost-chip {
    padding: 11px 14px;
    background: rgba(23, 25, 28, 0.08);
    box-shadow: none;
  }

  .ghost-chip-icon {
    width: 42px;
    height: 42px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.3rem;
    line-height: 1;
  }

  .primary-button {
    padding: 12px 16px;
    background: #17191c;
    color: #f8f7f4;
    font-weight: 600;
  }

  .text-button {
    border: 0;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    padding: 0;
  }

  .panel-section,
  .filter-section,
  .search-results,
  .list-stack,
  .segment-row {
    display: grid;
    gap: 12px;
  }

  .token-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .token-wrap button,
  .segment-row button {
    padding: 12px 14px;
    white-space: nowrap;
  }

  .token-wrap button.active,
  .segment-row button.active {
    background: #17191c;
    color: #f8f7f4;
  }

  .token-wrap-categories button {
    max-width: 100%;
  }

  .filter-token {
    display: grid;
    gap: 2px;
    text-align: left;
  }

  .filter-token strong,
  .filter-token small {
    font: inherit;
    line-height: 1.2;
  }

  .filter-token small {
    color: rgba(23, 25, 28, 0.58);
    font-size: 0.78rem;
  }

  .token-wrap button.active .filter-token small {
    color: rgba(248, 247, 244, 0.84);
  }

  .segment-row {
    display: flex;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }

  .selection-hero {
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 18px 36px rgba(17, 24, 39, 0.08);
    overflow: hidden;
    text-align: left;
    display: grid;
    grid-template-columns: 108px 1fr auto;
    gap: 0;
    margin-bottom: 14px;
  }

  .selection-media {
    background: linear-gradient(140deg, rgba(23, 25, 28, 0.08), rgba(200, 100, 59, 0.16));
  }

  .selection-media img,
  .selection-placeholder {
    width: 100%;
    height: 100%;
    min-height: 132px;
    object-fit: cover;
    display: grid;
    place-items: center;
    color: rgba(23, 25, 28, 0.56);
  }

  .selection-copy {
    padding: 14px 14px 14px 0;
    display: grid;
    gap: 8px;
  }

  .selection-copy h2,
  .selection-copy p,
  .selection-copy small {
    margin: 0;
  }

  .selection-copy p,
  .selection-copy small,
  .selection-metrics span {
    color: var(--ink-soft);
  }

  .selection-topline,
  .selection-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    align-items: center;
    font-size: 0.84rem;
  }

  .selection-cta {
    display: inline-flex;
    align-items: center;
    padding: 16px 14px 0 0;
    color: #17191c;
    font-weight: 600;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 0.82rem;
    font-weight: 700;
  }

  .status-pill.open {
    background: rgba(47, 125, 87, 0.12);
    color: #20583d;
  }

  .status-pill.closingSoon {
    background: rgba(200, 100, 59, 0.14);
    color: #8b4b30;
  }

  .status-pill.closed {
    background: rgba(107, 114, 128, 0.14);
    color: #5a6270;
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
    background: rgba(255, 255, 255, 0.8);
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

  input[type='search'] {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.9);
    color: var(--ink);
  }

  .skeleton {
    height: 154px;
    background:
      linear-gradient(90deg, rgba(23, 25, 28, 0.05), rgba(23, 25, 28, 0.12), rgba(23, 25, 28, 0.05));
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

    .top-chrome {
      left: 24px;
      right: 24px;
      top: calc(18px + env(safe-area-inset-top));
    }

    .viewport-chip {
      top: calc(90px + env(safe-area-inset-top));
    }

    .floating-panel {
      left: 24px;
      right: auto;
    }
  }

  @media (max-width: 640px) {
    .top-chrome {
      gap: 8px;
      left: 12px;
      right: 12px;
    }

    .top-actions {
      gap: 8px;
    }

    .filter-button {
      min-width: 52px;
      padding: 0 14px;
    }

    .filter-button span {
      display: none;
    }

    .floating-panel {
      left: 12px;
      right: 12px;
      top: calc(74px + env(safe-area-inset-top));
      padding: 14px;
    }

    .selection-hero {
      grid-template-columns: 92px 1fr auto;
    }

    .selection-media img,
    .selection-placeholder {
      min-height: 124px;
    }

    .selection-copy {
      padding-right: 10px;
    }

    .selection-cta {
      padding-right: 12px;
      font-size: 0.84rem;
    }
  }
</style>
