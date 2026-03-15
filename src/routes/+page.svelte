<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { createQuery } from '@tanstack/svelte-query';
  import { _ } from 'svelte-i18n';
  import { onDestroy, onMount, tick } from 'svelte';

  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import PlaceCard from '$lib/components/PlaceCard.svelte';
  import { DEFAULT_CENTER, SEARCH_REDRAW_METERS } from '$lib/config';
  import { loadPlaceDetails, loadPlaceSummary } from '$lib/data/client';
  import type { ActiveFilters, DisplayPlace, PlaceDetail, PlaceSummary, SheetSnap, SortKey } from '$lib/types';
  import { formatPriceRange, normalizePriceBand } from '$lib/utils/format';
  import { haversineDistanceMeters, isInsideBounds, walkMinutesFromDistance } from '$lib/utils/geo';
  import { derivePlaceStatus } from '$lib/utils/hours';
  import { countActiveFilters, summarizeFilters } from '$lib/utils/discovery';
  import { sortPlaces } from '$lib/utils/sort';

  type FilterSection = 'category' | 'walk' | 'price' | null;
  type UiView = 'browse' | 'filters' | 'detail';
  type UiRouteState = {
    view: UiView;
    selectedPlaceId: string | null;
    sheetSnap: SheetSnap;
    section: FilterSection;
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
  const REFRESH_PROMPT_VISIBLE_MS = 2200;
  const REFRESH_PROMPT_FADE_MS = 320;

  const PRICE_BANDS = Array.from({ length: 5 }, (_, index) => '\u00A5'.repeat(index + 1));
  const WALK_MINUTE_OPTIONS = [5, 10, 15, 30];
  let innerWidth = 390;
  let sheetSnap: SheetSnap = 'peek';
  let sortKey: SortKey = 'best';
  let activeFilters: ActiveFilters = { ...EMPTY_FILTERS };
  let filterOpen = false;
  let detailOpen = false;
  let selectedPlaceId: string | null = null;
  let searchCenter = { ...DEFAULT_CENTER };
  let mapCenter = { ...DEFAULT_CENTER };
  let mapBounds: { north: number; south: number; east: number; west: number } | null = null;
  let userLocation: { lat: number; lng: number } | null = null;
  let focusTarget: { lat: number; lng: number; zoom?: number; token: string } | null = {
    ...DEFAULT_CENTER,
    zoom: 4.8,
    token: 'initial'
  };
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
  let showRedoSearch = false;
  let redoSearchFading = false;
  let desktop = false;
  let activeFilterCount = 0;
  let filterSummary = 'All nearby';
  let pendingFilterSection: FilterSection = null;
  let categorySectionElement: HTMLElement | null = null;
  let walkSectionElement: HTMLElement | null = null;
  let priceSectionElement: HTMLElement | null = null;
  let MapViewComponent: typeof import('$lib/components/MapView.svelte').default | null = null;
  let DetailSheetComponent: typeof import('$lib/components/PlaceDetailSheet.svelte').default | null = null;
  let uiRouteState: UiRouteState = {
    view: 'browse',
    selectedPlaceId: null,
    sheetSnap: 'peek',
    section: null
  };
  let lastFilterScrollKey = '';
  let refreshPromptFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshPromptHideTimer: ReturnType<typeof setTimeout> | null = null;
  let mapHasInitialized = false;
  let suppressNextMoveRefreshPrompt = false;

  function randomToken(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function clearRefreshPromptTimers() {
    if (refreshPromptFadeTimer) {
      clearTimeout(refreshPromptFadeTimer);
      refreshPromptFadeTimer = null;
    }

    if (refreshPromptHideTimer) {
      clearTimeout(refreshPromptHideTimer);
      refreshPromptHideTimer = null;
    }
  }

  function hideRefreshPrompt() {
    clearRefreshPromptTimers();
    redoSearchFading = false;
    showRedoSearch = false;
  }

  function queueRefreshPrompt() {
    if (!browser) {
      return;
    }

    clearRefreshPromptTimers();
    showRedoSearch = true;
    redoSearchFading = false;
    refreshPromptFadeTimer = setTimeout(() => {
      redoSearchFading = true;
    }, REFRESH_PROMPT_VISIBLE_MS);
    refreshPromptHideTimer = setTimeout(() => {
      hideRefreshPrompt();
    }, REFRESH_PROMPT_VISIBLE_MS + REFRESH_PROMPT_FADE_MS);
  }

  function applyRefreshPrompt() {
    suppressNextMoveRefreshPrompt = true;
    searchCenter = { ...mapCenter };
    focusTarget = { ...mapCenter, token: randomToken('refresh') };
    hideRefreshPrompt();
  }

  function updateFilters(nextFilters: ActiveFilters) {
    activeFilters = nextFilters;
    queueRefreshPrompt();
  }

  function priceSortAriaLabel() {
    return sortKey === 'priceDesc' ? 'Price descending' : 'Price ascending';
  }

  function parseUiView(value: string | null): UiView {
    return value === 'filters' || value === 'detail' ? value : 'browse';
  }

  function parseSheetSnap(value: string | null): SheetSnap {
    return value === 'peek' || value === 'mid' || value === 'full' ? value : 'peek';
  }

  function parseFilterSection(value: string | null): FilterSection {
    return value === 'category' || value === 'walk' || value === 'price' ? value : null;
  }

  function readUiRouteState(url: URL): UiRouteState {
    const view = parseUiView(url.searchParams.get('panel'));
    return {
      view,
      selectedPlaceId: url.searchParams.get('place') || null,
      sheetSnap: view === 'browse' ? parseSheetSnap(url.searchParams.get('sheet')) : 'full',
      section: view === 'filters' ? parseFilterSection(url.searchParams.get('section')) : null
    };
  }

  function uiRouteHref(state: UiRouteState) {
    const params = new URLSearchParams();

    if (state.view !== 'browse') {
      params.set('panel', state.view);
    }

    if (state.selectedPlaceId) {
      params.set('place', state.selectedPlaceId);
    }

    if (state.view === 'browse' && state.sheetSnap !== 'peek') {
      params.set('sheet', state.sheetSnap);
    }

    if (state.view === 'filters' && state.section) {
      params.set('section', state.section);
    }

    const query = params.toString();
    return `${$page.url.pathname}${query ? `?${query}` : ''}`;
  }

  async function navigateUiState(state: UiRouteState, options: { replace?: boolean } = {}) {
    if (!browser) {
      return;
    }

    const href = uiRouteHref(state);
    const currentHref = `${$page.url.pathname}${$page.url.search}`;
    if (href === currentHref) {
      return;
    }

    await goto(href, {
      replaceState: options.replace ?? false,
      keepFocus: true,
      noScroll: true
    });
  }

  function currentBrowseState(overrides: Partial<UiRouteState> = {}): UiRouteState {
    return {
      view: 'browse',
      selectedPlaceId,
      sheetSnap,
      section: null,
      ...overrides
    };
  }

  function closeDetail() {
    void navigateUiState(currentBrowseState({ sheetSnap: desktop ? sheetSnap : 'mid' }), { replace: true });
  }

  function togglePriceSort() {
    sortKey = sortKey === 'priceAsc' ? 'priceDesc' : 'priceAsc';
    queueRefreshPrompt();
  }

  function setWalkMinutes(minutes: number) {
    updateFilters({
      ...activeFilters,
      maxWalkMinutes: activeFilters.maxWalkMinutes === minutes ? null : minutes
    });
  }

  async function openFilters(section: FilterSection = null) {
    pendingFilterSection = section;
    await navigateUiState(
      {
        view: 'filters',
        selectedPlaceId,
        sheetSnap: 'full',
        section
      },
      { replace: uiRouteState.view === 'filters' }
    );
  }

  function closeFilters() {
    void navigateUiState(currentBrowseState({ sheetSnap: desktop ? sheetSnap : 'mid' }), { replace: true });
  }

  function clearFilters() {
    updateFilters({ ...EMPTY_FILTERS });
  }

  function toggleOpenNowFilter() {
    updateFilters({
      ...activeFilters,
      openNow: !activeFilters.openNow
    });
  }

  function toggleClosingSoonFilter() {
    updateFilters({
      ...activeFilters,
      closingSoon: !activeFilters.closingSoon
    });
  }

  function resetAvailabilityFilters() {
    updateFilters({
      ...activeFilters,
      openNow: false,
      closingSoon: false
    });
  }

  function setSortKey(nextSortKey: SortKey) {
    sortKey = nextSortKey;
    queueRefreshPrompt();
  }

  function categoryFilterLabel() {
    if (activeFilters.categoryKeys.length === 0) {
      return 'Cuisine';
    }

    if (activeFilters.categoryKeys.length === 1) {
      const match = availableCategories.find((category) => category.key === activeFilters.categoryKeys[0]);
      return match?.label ?? 'Cuisine';
    }

    return `${activeFilters.categoryKeys.length} cuisines`;
  }

  function walkFilterLabel() {
    return activeFilters.maxWalkMinutes === null ? 'Walk time' : `\u2264 ${activeFilters.maxWalkMinutes} min`;
  }

  function priceFilterLabel() {
    if (activeFilters.priceBands.length === 0) {
      return 'Price';
    }

    if (activeFilters.priceBands.length === 1) {
      return activeFilters.priceBands[0];
    }

    return `${activeFilters.priceBands.length} price levels`;
  }

  function openDetail() {
    if (!selectedPlaceId) {
      return;
    }

    void navigateUiState({
      view: 'detail',
      selectedPlaceId,
      sheetSnap: 'full',
      section: null
    });
  }

  function openDirections(place: PlaceSummary) {
    if (!browser) {
      return;
    }

    const params = new URLSearchParams({
      api: '1',
      destination: `${place.nameEn ?? place.nameJp ?? 'Restaurant'} ${place.lat},${place.lng}`
    });

    if (place.placeId) {
      params.set('destination_place_id', place.placeId);
    }

    const url = `https://www.google.com/maps/dir/?${params.toString()}`;
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
    updateFilters({
      ...activeFilters,
      categoryKeys: activeFilters.categoryKeys.includes(key)
        ? activeFilters.categoryKeys.filter((value) => value !== key)
        : [...activeFilters.categoryKeys, key]
    });
  }

  function togglePriceBand(band: string) {
    updateFilters({
      ...activeFilters,
      priceBands: activeFilters.priceBands.includes(band)
        ? activeFilters.priceBands.filter((value) => value !== band)
        : [...activeFilters.priceBands, band]
    });
  }

  function handlePlaceSelect(placeId: string) {
    void navigateUiState({
      view: 'detail',
      selectedPlaceId: placeId,
      sheetSnap: 'full',
      section: null
    });
  }

  function handleMapSelect(placeId: string) {
    if (selectedPlaceId === placeId) {
      openDetail();
      return;
    }

    void navigateUiState(currentBrowseState({ selectedPlaceId: placeId, sheetSnap: desktop ? sheetSnap : 'mid' }));
  }

  function handleSheetSnapChange(event: CustomEvent<{ snap: SheetSnap }>) {
    const nextSnap = event.detail.snap;
    sheetSnap = nextSnap;

    if (desktop) {
      return;
    }

    if (filterOpen || detailOpen) {
      if (nextSnap === 'full') {
        return;
      }

      void navigateUiState(currentBrowseState({ sheetSnap: nextSnap }), { replace: true });
      return;
    }

    void navigateUiState(currentBrowseState({ sheetSnap: nextSnap }), { replace: true });
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

  function scrollToFilterSection(section: FilterSection) {
    const target =
      section === 'category'
        ? categorySectionElement
        : section === 'walk'
          ? walkSectionElement
          : section === 'price'
            ? priceSectionElement
            : null;

    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  onMount(() => {
    void (async () => {
      const [{ default: mapView }, { default: detailSheet }] = await Promise.all([
        import('$lib/components/MapView.svelte'),
        import('$lib/components/PlaceDetailSheet.svelte')
      ]);
      MapViewComponent = mapView;
      DetailSheetComponent = detailSheet;
      requestGeolocation();
    })();
  });

  onDestroy(() => {
    clearRefreshPromptTimers();
  });

  $: desktop = innerWidth >= 960;
  $: uiRouteState = readUiRouteState($page.url);
  $: filterOpen = uiRouteState.view === 'filters';
  $: detailOpen = uiRouteState.view === 'detail';
  $: selectedPlaceId = uiRouteState.selectedPlaceId;
  $: sheetSnap = uiRouteState.view === 'browse' ? uiRouteState.sheetSnap : 'full';
  $: pendingFilterSection = filterOpen ? uiRouteState.section : null;
  $: summaries = $summaryQuery.data ?? [];
  $: details = $detailQuery.data ?? {};
  $: availableCategories = visibleCategories(summaries);
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
  $: if (browser && sortedPlaces.length) {
    const fallbackId = sortedPlaces[0].id;
    const hasSelectedPlace = selectedPlaceId ? sortedPlaces.some((place) => place.id === selectedPlaceId) : false;
    const nextSelectedPlaceId = hasSelectedPlace ? selectedPlaceId : fallbackId;
    const nextView = detailOpen && !nextSelectedPlaceId ? 'browse' : uiRouteState.view;
    const nextSheetSnap = nextView === 'browse' ? uiRouteState.sheetSnap : 'full';

    if (selectedPlaceId !== nextSelectedPlaceId || nextView !== uiRouteState.view) {
      void navigateUiState(
        {
          view: nextView,
          selectedPlaceId: nextSelectedPlaceId,
          sheetSnap: nextSheetSnap,
          section: nextView === 'filters' ? uiRouteState.section : null
        },
        { replace: true }
      );
    }
  }
  $: if (browser && !sortedPlaces.length && (selectedPlaceId !== null || detailOpen)) {
    void navigateUiState(
      {
        view: filterOpen ? 'filters' : 'browse',
        selectedPlaceId: null,
        sheetSnap: 'peek',
        section: filterOpen ? uiRouteState.section : null
      },
      { replace: true }
    );
  }
  $: selectedPlace = sortedPlaces.find((place) => place.id === selectedPlaceId) ?? null;
  $: selectedDetail = selectedPlaceId ? details[selectedPlaceId] ?? null : null;
  $: visiblePlaces = sortedPlaces.slice(0, 80);
  $: mobileListPlaces = visiblePlaces;
  $: {
    const scrollKey = filterOpen && pendingFilterSection ? `${pendingFilterSection}:${$page.url.search}` : '';
    if (scrollKey && scrollKey !== lastFilterScrollKey) {
      lastFilterScrollKey = scrollKey;
      void tick().then(() => scrollToFilterSection(pendingFilterSection));
    }
    if (!scrollKey) {
      lastFilterScrollKey = '';
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
        {desktop}
        on:moveend={(event) => {
          const nextCenter = event.detail.center;
          const movedDistance = haversineDistanceMeters(mapCenter, nextCenter);
          mapCenter = event.detail.center;
          mapBounds = event.detail.bounds;

          if (!mapHasInitialized) {
            mapHasInitialized = true;
            return;
          }

          if (suppressNextMoveRefreshPrompt) {
            suppressNextMoveRefreshPrompt = false;
            return;
          }

          if (movedDistance > SEARCH_REDRAW_METERS) {
            queueRefreshPrompt();
          }
        }}
        on:select={(event) => handleMapSelect(event.detail.id)}
      />
    {:else}
      <div class="map-loading">Loading map</div>
    {/if}

    <div class="map-gradient"></div>

    <div class="top-chrome">
      <div class="top-filter-row" aria-label="Quick filters">
        <button type="button" class="filter-pill" class:active={activeFilters.categoryKeys.length > 0} on:click={() => openFilters('category')}>
          {categoryFilterLabel()}
        </button>
        <button type="button" class="filter-pill" class:active={activeFilters.maxWalkMinutes !== null} on:click={() => openFilters('walk')}>
          {walkFilterLabel()}
        </button>
        <button type="button" class="filter-pill" class:active={activeFilters.priceBands.length > 0} on:click={() => openFilters('price')}>
          {priceFilterLabel()}
        </button>
      </div>

      <div class="top-actions">
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
        class:fading={redoSearchFading}
        on:click={applyRefreshPrompt}
      >
        {$_('searchArea')}
      </button>
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
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" />
            </svg>
          </button>
        </div>

        <p class="filter-summary">{filterSummary}</p>

        <section class="filter-section">
          <div class="section-heading">
            <h3>Availability</h3>
            {#if activeFilters.openNow || activeFilters.closingSoon}
              <button type="button" class="text-button" on:click={resetAvailabilityFilters}>
                Reset
              </button>
            {/if}
          </div>
          <div class="token-wrap">
            <button type="button" class:active={activeFilters.openNow} on:click={toggleOpenNowFilter}>
              Open now
            </button>
            <button
              type="button"
              class:active={activeFilters.closingSoon}
              on:click={toggleClosingSoonFilter}
            >
              Closing soon
            </button>
          </div>
        </section>

        <section bind:this={walkSectionElement} class="filter-section">
          <div class="section-heading">
            <h3>Walk time</h3>
          </div>
          <div class="token-wrap">
            {#each WALK_MINUTE_OPTIONS as minutes}
              <button type="button" class:active={activeFilters.maxWalkMinutes === minutes} on:click={() => setWalkMinutes(minutes)}>
                ≤ {minutes} min
              </button>
            {/each}
          </div>
        </section>

        <section bind:this={priceSectionElement} class="filter-section">
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

        <section bind:this={categorySectionElement} class="filter-section">
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
              on:close={closeDetail}
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
            <button type="button" class="ghost-chip" on:click={() => openFilters()}>
              Filters{#if activeFilterCount > 0} {activeFilterCount}{/if}
            </button>
          </div>

          <div class="segment-row">
            <button type="button" class:active={sortKey === 'best'} on:click={() => setSortKey('best')}>Best nearby</button>
            <button type="button" class:active={sortKey === 'distance'} on:click={() => setSortKey('distance')}>Nearest</button>
            <button
              type="button"
              aria-label={priceSortAriaLabel()}
              class:active={sortKey === 'priceAsc' || sortKey === 'priceDesc'}
              on:click={togglePriceSort}
            >
              Price
              <span class="sort-icon" aria-hidden="true">
                {#if sortKey === 'priceDesc'}
                  <svg viewBox="0 0 12 12">
                    <path d="M6 2.25v7.5M6 9.75 3.75 7.5M6 9.75 8.25 7.5" />
                  </svg>
                {:else}
                  <svg viewBox="0 0 12 12">
                    <path d="M6 9.75v-7.5M6 2.25 3.75 4.5M6 2.25 8.25 4.5" />
                  </svg>
                {/if}
              </span>
            </button>
          </div>

          {#if $summaryQuery.isLoading}
            {#each Array.from({ length: 6 }) as _, index (index)}
              <div class="skeleton" aria-hidden="true"></div>
            {/each}
          {:else if !sortedPlaces.length}
            <div class="empty-state">
              <h3>No places in this view</h3>
              <p>Pan or zoom to explore another area in Japan.</p>
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
      <BottomSheet
        snap={sheetSnap}
        title={filterOpen ? 'Filters' : detailOpen ? 'Place details' : 'Places'}
        on:snapchange={handleSheetSnapChange}
      >
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
            <button type="button" class:active={activeFilters.openNow} on:click={toggleOpenNowFilter}>
              Open now
            </button>
            <button
              type="button"
              class:active={activeFilters.closingSoon}
              on:click={toggleClosingSoonFilter}
            >
              Closing soon
            </button>
          </div>
        </section>

        <section bind:this={walkSectionElement} class="filter-section">
          <div class="section-heading">
            <h3>Walk time</h3>
          </div>
          <div class="token-wrap">
            {#each WALK_MINUTE_OPTIONS as minutes}
              <button type="button" class:active={activeFilters.maxWalkMinutes === minutes} on:click={() => setWalkMinutes(minutes)}>
                ≤ {minutes} min
              </button>
            {/each}
          </div>
        </section>

        <section bind:this={priceSectionElement} class="filter-section">
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

        <section bind:this={categorySectionElement} class="filter-section">
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
            on:close={closeDetail}
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
          <button type="button" class="ghost-chip" on:click={() => openFilters()}>
            Filters{#if activeFilterCount > 0} {activeFilterCount}{/if}
          </button>
        </div>

        {#if selectedPlace}
          <div class="selection-hero">
            <PlaceCard
              place={selectedPlace}
              imageUrl={selectedDetail?.imageUrl ?? null}
              selected={true}
              layout="expanded"
              on:select={openDetail}
              on:directions={() => openDirections(selectedPlace)}
              on:reserve={() => openReserve(selectedPlace)}
            />
          </div>
        {/if}

        <div class="segment-row segment-row-mobile">
          <button type="button" class:active={sortKey === 'best'} on:click={() => setSortKey('best')}>Best nearby</button>
          <button type="button" class:active={sortKey === 'distance'} on:click={() => setSortKey('distance')}>Nearest</button>
          <button
            type="button"
            aria-label={priceSortAriaLabel()}
            class:active={sortKey === 'priceAsc' || sortKey === 'priceDesc'}
            on:click={togglePriceSort}
          >
            Price
            <span class="sort-icon" aria-hidden="true">
              {#if sortKey === 'priceDesc'}
                <svg viewBox="0 0 12 12">
                  <path d="M6 2.25v7.5M6 9.75 3.75 7.5M6 9.75 8.25 7.5" />
                </svg>
              {:else}
                <svg viewBox="0 0 12 12">
                  <path d="M6 9.75v-7.5M6 2.25 3.75 4.5M6 2.25 8.25 4.5" />
                </svg>
              {/if}
            </span>
          </button>
        </div>

        {#if $summaryQuery.isLoading}
          {#each Array.from({ length: 4 }) as _, index (index)}
            <div class="skeleton" aria-hidden="true"></div>
          {/each}
        {:else if !sortedPlaces.length}
          <div class="empty-state">
            <h3>No places in this view</h3>
            <p>Pan or zoom to explore another area in Japan.</p>
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
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
    animation: rise-fade 280ms ease both;
  }

  .filter-pill,
  .icon-button,
  .ghost-chip,
  .token-wrap button,
  .segment-row button,
  .primary-button {
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.88);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
  }

  .top-filter-row {
    min-width: 0;
    display: flex;
    gap: 10px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0 2px 2px 0;
  }

  .top-filter-row::-webkit-scrollbar {
    display: none;
  }

  .filter-pill {
    flex: 0 0 auto;
    min-height: 52px;
    padding: 14px 16px;
    font-weight: 600;
    line-height: 1.1;
    backdrop-filter: blur(12px);
  }

  .filter-pill.active {
    background: #17191c;
    color: #f8f7f4;
  }

  .top-actions {
    display: flex;
    gap: 12px;
    flex: 0 0 auto;
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
    animation: viewport-rise 220ms ease both;
    transition:
      opacity 320ms ease,
      transform 320ms ease;
  }

  .viewport-chip.fading {
    opacity: 0;
    transform: translateX(-50%) translateY(-4px);
    pointer-events: none;
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
    animation: rise-fade 220ms ease both;
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
    gap: 14px;
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
  }

  .ghost-chip-icon svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.75;
    stroke-linecap: round;
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

  .filter-section,
  .list-stack,
  .segment-row {
    display: grid;
    gap: 12px;
  }

  .token-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .token-wrap button,
  .segment-row button {
    min-height: 44px;
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
    gap: 10px;
    margin-bottom: 14px;
  }

  .sort-icon {
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .sort-icon svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .selection-hero {
    margin-bottom: 14px;
    animation: rise-fade 240ms ease both;
  }

  .result-limit,
  .empty-state,
  .skeleton {
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.8);
    border: 1px solid var(--line);
  }

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

  @keyframes rise-fade {
    from {
      opacity: 0;
      transform: translateY(10px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes viewport-rise {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(10px);
    }

    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
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
      left: 12px;
      right: 12px;
    }

    .top-actions {
      gap: 8px;
      align-self: start;
    }

    .top-filter-row {
      gap: 6px;
    }

    .floating-panel {
      left: 12px;
      right: 12px;
      top: calc(74px + env(safe-area-inset-top));
      padding: 14px;
    }

    .selection-hero {
      margin-bottom: 12px;
    }
  }
</style>

