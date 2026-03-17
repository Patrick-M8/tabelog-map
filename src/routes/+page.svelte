<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { createQuery } from '@tanstack/svelte-query';
  import { onMount, tick } from 'svelte';

  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import FilterPanelContent from '$lib/components/FilterPanelContent.svelte';
  import PlaceCard from '$lib/components/PlaceCard.svelte';
  import { DEFAULT_CENTER, SEARCH_REDRAW_METERS } from '$lib/config';
  import { loadPlaceDetails, loadPlaceSummary } from '$lib/data/client';
  import type { ActiveFilters, DisplayPlace, PlaceDetail, PlaceSummary, ReviewSource, SheetSnap, SortKey } from '$lib/types';
  import { normalizePriceBand } from '$lib/utils/format';
  import { haversineDistanceMeters, isInsideBounds, walkMinutesFromDistance } from '$lib/utils/geo';
  import { derivePlaceStatus } from '$lib/utils/hours';
  import { countActiveFilters, summarizeFilters } from '$lib/utils/discovery';
  import { sortPlaces } from '$lib/utils/sort';
  import { sortKeyToTraySortState, toggleReviewDirection, toggleReviewSource, traySortStateToSortKey } from '$lib/utils/traySort';

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
    openingSoon: false,
    maxWalkMinutes: null,
    priceBands: [],
    categoryKeys: []
  };
  const REFRESH_PROMPT_VISIBLE_MS = 2200;
  const REFRESH_PROMPT_FADE_MS = 320;
  const CUISINE_PREVIEW_COUNT = 10;
  const DEFAULT_BROWSE_SNAP: SheetSnap = 'mid';
  const PRICE_BANDS = Array.from({ length: 5 }, (_, index) => '\u00A5'.repeat(index + 1));
  const WALK_MINUTE_OPTIONS = [5, 10, 15, 30];
  const REVIEW_SOURCES: ReviewSource[] = ['tabelog', 'google'];
  const BRAND_MARKS: Record<ReviewSource, string> = {
    tabelog: '/brands/tabelog.png',
    google: '/brands/google logo.png'
  };
  let innerWidth = 390;
  let sheetSnap: SheetSnap = DEFAULT_BROWSE_SNAP;
  let sortKey: SortKey = 'best';
  let activeReviewSources: ReviewSource[] = [];
  let activeReviewDirection: 'asc' | 'desc' = 'desc';
  let reviewSortActive = false;
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
  let priceSortLabel = 'Price ascending';
  let reviewSortLabel = 'Rating descending';
  let pendingFilterSection: FilterSection = null;
  let categorySectionElement: HTMLElement | null = null;
  let walkSectionElement: HTMLElement | null = null;
  let priceSectionElement: HTMLElement | null = null;
  let cuisineExpanded = false;
  let visibleCuisineCategories: { key: string; label: string; count: number }[] = [];
  let MapViewComponent: typeof import('$lib/components/MapView.svelte').default | null = null;
  let DetailSheetComponent: typeof import('$lib/components/PlaceDetailSheet.svelte').default | null = null;
  let uiRouteState: UiRouteState = {
    view: 'browse',
    selectedPlaceId: null,
    sheetSnap: DEFAULT_BROWSE_SNAP,
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

  function setReviewSort(source: ReviewSource) {
    sortKey = traySortStateToSortKey(toggleReviewSource(sortKeyToTraySortState(sortKey), source));
  }

  function toggleReviewSortDirection() {
    if (!activeReviewSources.length) {
      return;
    }

    sortKey = traySortStateToSortKey(toggleReviewDirection(sortKeyToTraySortState(sortKey)));
  }

  function parseUiView(value: string | null): UiView {
    return value === 'filters' || value === 'detail' ? value : 'browse';
  }

  function parseSheetSnap(value: string | null): SheetSnap {
    return value === 'peek' || value === 'mid' || value === 'full' ? value : DEFAULT_BROWSE_SNAP;
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

    if (state.view === 'browse' && state.sheetSnap !== DEFAULT_BROWSE_SNAP) {
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

  function clearAdvancedFilters() {
    cuisineExpanded = false;
    updateFilters({
      ...activeFilters,
      closingSoon: false,
      openingSoon: false,
      maxWalkMinutes: null,
      priceBands: [],
      categoryKeys: []
    });
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

  function toggleOpeningSoonFilter() {
    updateFilters({
      ...activeFilters,
      openingSoon: !activeFilters.openingSoon
    });
  }

  function setSortKey(nextSortKey: SortKey) {
    sortKey = nextSortKey;
  }

  function resetAvailabilityFilters() {
    updateFilters({
      ...activeFilters,
      closingSoon: false,
      openingSoon: false
    });
  }

  function placesInViewLabel(total: number, visible: number) {
    if (total > visible) {
      return `${visible} of ${total} places in view`;
    }

    return `${total} places in view`;
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
    const categoryFilterLabel = (label: string) => {
      if (label === '中国料理') {
        return 'Chinese';
      }

      if (label === 'Creative Cuisine/Innovative') {
        return 'Creative/Innovative';
      }

      if (label === 'Shokudo (Japanese Diner)') {
        return 'Shokudo';
      }

      return label;
    };

    const counts = new Map<string, { key: string; label: string; count: number }>();
    for (const place of places) {
      const key = place.category.key;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { key, label: categoryFilterLabel(place.category.label), count: 1 });
      }
    }

    return [...counts.values()].sort((left, right) => left.label.localeCompare(right.label, 'en', { sensitivity: 'base' }));
  }

  function visibleCuisineOptions(
    categories: { key: string; label: string; count: number }[],
    selectedKeys: string[],
    expanded: boolean
  ) {
    if (expanded || categories.length <= CUISINE_PREVIEW_COUNT) {
      return categories;
    }

    const selected = new Set(selectedKeys);
    const next: typeof categories = [];

    for (const category of categories) {
      if (next.length < CUISINE_PREVIEW_COUNT || selected.has(category.key)) {
        next.push(category);
      }
    }

    return next;
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

    return () => {
      clearRefreshPromptTimers();
    };
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
  $: {
    const nextReviewState = sortKeyToTraySortState(sortKey).reviewSort;
    activeReviewSources = [...nextReviewState.sources];
    activeReviewDirection = nextReviewState.direction;
    reviewSortActive = activeReviewSources.length > 0;
  }
  $: activeFilterCount = countActiveFilters(activeFilters);
  $: filterSummary = summarizeFilters(activeFilters);
  $: priceSortLabel = sortKey === 'priceDesc' ? 'Price descending' : 'Price ascending';
  $: reviewSortLabel =
    activeReviewSources.length === 2
      ? `Combined average ${activeReviewDirection === 'asc' ? 'ascending' : 'descending'}`
      : `Rating ${activeReviewDirection === 'asc' ? 'ascending' : 'descending'}`;
  $: candidatePlaces = summaries
    .map((place) => {
      const distanceMeters = haversineDistanceMeters(searchCenter, { lat: place.lat, lng: place.lng });
      return {
        ...place,
        distanceMeters,
        walkMinutes: walkMinutesFromDistance(distanceMeters),
        status: derivePlaceStatus(place.weeklyTimeline, place.closure)
      } satisfies DisplayPlace;
    })
    .filter((place) =>
      activeFilters.openNow ? place.status.state === 'open' || place.status.state === 'closingSoon' : true
    )
    .filter((place) => (activeFilters.closingSoon ? place.status.state === 'closingSoon' : true))
    .filter((place) => (activeFilters.openingSoon ? place.status.state === 'openingSoon' : true))
    .filter((place) => (activeFilters.maxWalkMinutes ? place.walkMinutes <= activeFilters.maxWalkMinutes : true))
    .filter((place) =>
      activeFilters.priceBands.length
        ? activeFilters.priceBands.includes(normalizePriceBand(place.priceBand, place.priceBucket) ?? '')
        : true
    )
    .filter((place) => (activeFilters.categoryKeys.length ? activeFilters.categoryKeys.includes(place.category.key) : true));
  $: displayPlaces = candidatePlaces.filter((place) => isInsideBounds({ lat: place.lat, lng: place.lng }, mapBounds));
  $: sortedPlaces = sortPlaces(displayPlaces, sortKey);
  $: if (browser && detailOpen && (!selectedPlaceId || !sortedPlaces.some((place) => place.id === selectedPlaceId))) {
    void navigateUiState(
      {
        view: 'browse',
        selectedPlaceId: null,
        sheetSnap: 'mid',
        section: null
      },
      { replace: true }
    );
  }
  $: if (browser && !sortedPlaces.length && (selectedPlaceId !== null || detailOpen)) {
    void navigateUiState(
      {
        view: filterOpen ? 'filters' : 'browse',
        selectedPlaceId: null,
        sheetSnap: DEFAULT_BROWSE_SNAP,
        section: filterOpen ? uiRouteState.section : null
      },
      { replace: true }
    );
  }
  $: selectedPlace = sortedPlaces.find((place) => place.id === selectedPlaceId) ?? null;
  $: selectedDetail = selectedPlaceId ? details[selectedPlaceId] ?? null : null;
  $: visiblePlaces = sortedPlaces.slice(0, 80);
  $: mobileListPlaces = selectedPlace ? visiblePlaces.filter((place) => place.id !== selectedPlace.id) : visiblePlaces;
  $: visibleCuisineCategories = visibleCuisineOptions(availableCategories, activeFilters.categoryKeys, cuisineExpanded);
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
          mapCenter = nextCenter;
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
      <div class="top-actions">
        <button type="button" class="filter-pill filter-pill-utility" on:click={() => openFilters()}>
          Filters{#if activeFilterCount > 0} {activeFilterCount}{/if}
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
        class:fading={redoSearchFading}
        on:click={applyRefreshPrompt}
      >
        Search this area
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

        {#if activeFilterCount > 0}
          <p class="filter-summary">{filterSummary}</p>
        {/if}

        <FilterPanelContent
          bind:categorySectionElement
          bind:walkSectionElement
          bind:priceSectionElement
          {activeFilters}
          walkMinuteOptions={WALK_MINUTE_OPTIONS}
          priceBands={PRICE_BANDS}
          {visibleCuisineCategories}
          {availableCategories}
          bind:cuisineExpanded
          on:resetAvailability={resetAvailabilityFilters}
          on:toggleClosingSoon={toggleClosingSoonFilter}
          on:toggleOpeningSoon={toggleOpeningSoonFilter}
          on:setWalkMinutes={(event) => setWalkMinutes(event.detail.minutes)}
          on:togglePriceBand={(event) => togglePriceBand(event.detail.band)}
          on:toggleCategory={(event) => toggleCategory(event.detail.key)}
          on:toggleCuisineExpanded={() => (cuisineExpanded = !cuisineExpanded)}
        />

        <div class="filter-footer" class:with-clear={activeFilterCount > 0}>
          {#if activeFilterCount > 0}
            <button type="button" class="ghost-chip" on:click={clearAdvancedFilters}>Clear all</button>
          {/if}
          <button type="button" class="primary-button show-places-button" on:click={closeFilters}>Show {sortedPlaces.length} places</button>
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
            <div class="sheet-header-brand">
              <div>
                <p class="eyebrow">{placesInViewLabel(sortedPlaces.length, visiblePlaces.length)}</p>
                <h1>Tabelog Hyakumeiten</h1>
                <p class="sheet-summary">{filterSummary}</p>
              </div>
              <img class="sheet-brand-mark" src={BRAND_MARKS.tabelog} alt="Tabelog" />
            </div>
          </div>

          <div class="segment-row tray-row">
            <button type="button" class="tray-pill" class:active={sortKey === 'best'} on:click={() => setSortKey('best')}>Best</button>
            <button type="button" class="tray-pill" class:active={sortKey === 'distance'} on:click={() => setSortKey('distance')}>Near</button>
            <button
              type="button"
              class="tray-pill tray-pill-price"
              aria-label={priceSortLabel}
              class:active={sortKey === 'priceAsc' || sortKey === 'priceDesc'}
              on:click={togglePriceSort}
            >
              ¥
              <span class="sort-icon sort-icon-tight" aria-hidden="true">
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
            <div class="tray-ratings" role="group" aria-label="Review rating sort" class:active={reviewSortActive}>
              <div class="review-segment">
                {#each REVIEW_SOURCES as source}
                  <button
                    type="button"
                    class="review-segment-option"
                    class:active={activeReviewSources.includes(source)}
                    class:tabelog={source === 'tabelog'}
                    class:google={source === 'google'}
                    aria-label={`Sort by ${source === 'tabelog' ? 'Tabelog' : 'Google'} rating`}
                    aria-pressed={activeReviewSources.includes(source) ? 'true' : 'false'}
                    on:click={() => setReviewSort(source)}
                  >
                    <img src={BRAND_MARKS[source]} alt="" />
                  </button>
                {/each}
              </div>
              <button
                type="button"
                class="review-direction"
                aria-label={reviewSortLabel}
                class:active={reviewSortActive}
                disabled={!reviewSortActive}
                on:click={toggleReviewSortDirection}
              >
                <span class="sort-icon sort-icon-tight" aria-hidden="true">
                  {#if activeReviewDirection === 'desc'}
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
        <div class="mobile-filter-shell">
          <div class="sheet-header sheet-header-sticky sheet-header-mobile">
            <div>
              <h1>Filters</h1>
              {#if activeFilterCount > 0}
                <p class="sheet-summary">{filterSummary}</p>
              {/if}
            </div>
            <button type="button" class="ghost-chip ghost-chip-compact" on:click={closeFilters}>Done</button>
          </div>

          <div class="filter-section-stack">
            <FilterPanelContent
              bind:categorySectionElement
              bind:walkSectionElement
              bind:priceSectionElement
              {activeFilters}
              walkMinuteOptions={WALK_MINUTE_OPTIONS}
              priceBands={PRICE_BANDS}
              {visibleCuisineCategories}
              {availableCategories}
              bind:cuisineExpanded
              on:resetAvailability={resetAvailabilityFilters}
              on:toggleClosingSoon={toggleClosingSoonFilter}
              on:toggleOpeningSoon={toggleOpeningSoonFilter}
              on:setWalkMinutes={(event) => setWalkMinutes(event.detail.minutes)}
              on:togglePriceBand={(event) => togglePriceBand(event.detail.band)}
              on:toggleCategory={(event) => toggleCategory(event.detail.key)}
              on:toggleCuisineExpanded={() => (cuisineExpanded = !cuisineExpanded)}
            />
          </div>

          <div class="filter-footer filter-footer-sticky" class:with-clear={activeFilterCount > 0}>
            {#if activeFilterCount > 0}
              <button type="button" class="ghost-chip ghost-chip-compact" on:click={clearAdvancedFilters}>Clear all</button>
            {/if}
            <button type="button" class="primary-button show-places-button" on:click={closeFilters}>Show {sortedPlaces.length} places</button>
          </div>
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
          <div class="sheet-header-brand">
            <div>
              <p class="eyebrow">{placesInViewLabel(sortedPlaces.length, visiblePlaces.length)}</p>
              <h1>Tabelog Hyakumeiten</h1>
              <p class="sheet-summary">{filterSummary}</p>
            </div>
            <img class="sheet-brand-mark" src={BRAND_MARKS.tabelog} alt="Tabelog" />
          </div>
        </div>

        <div class="segment-row segment-row-mobile tray-row">
          <button type="button" class="tray-pill" class:active={sortKey === 'best'} on:click={() => setSortKey('best')}>Best</button>
          <button type="button" class="tray-pill" class:active={sortKey === 'distance'} on:click={() => setSortKey('distance')}>Near</button>
          <button
            type="button"
            class="tray-pill tray-pill-price"
            aria-label={priceSortLabel}
            class:active={sortKey === 'priceAsc' || sortKey === 'priceDesc'}
            on:click={togglePriceSort}
          >
            ¥
            <span class="sort-icon sort-icon-tight" aria-hidden="true">
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
          <div class="tray-ratings" role="group" aria-label="Review rating sort" class:active={reviewSortActive}>
            <div class="review-segment">
              {#each REVIEW_SOURCES as source}
                <button
                  type="button"
                  class="review-segment-option"
                  class:active={activeReviewSources.includes(source)}
                  class:tabelog={source === 'tabelog'}
                  class:google={source === 'google'}
                  aria-label={`Sort by ${source === 'tabelog' ? 'Tabelog' : 'Google'} rating`}
                  aria-pressed={activeReviewSources.includes(source) ? 'true' : 'false'}
                  on:click={() => setReviewSort(source)}
                >
                  <img src={BRAND_MARKS[source]} alt="" />
                </button>
              {/each}
            </div>
            <button
              type="button"
              class="review-direction"
              aria-label={reviewSortLabel}
              class:active={reviewSortActive}
              disabled={!reviewSortActive}
              on:click={toggleReviewSortDirection}
            >
              <span class="sort-icon sort-icon-tight" aria-hidden="true">
                {#if activeReviewDirection === 'desc'}
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
  .floating-panel,
  .panel-scrim {
    position: absolute;
    z-index: 24;
  }

  .top-chrome {
    top: calc(10px + env(safe-area-inset-top));
    left: 12px;
    right: 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
    animation: rise-fade 280ms ease both;
  }

  .filter-pill,
  .icon-button,
  .ghost-chip,
  .segment-row button,
  .primary-button {
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.88);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
    transition:
      background-color 180ms ease,
      color 180ms ease,
      border-color 180ms ease,
      transform 180ms ease;
  }

  .filter-pill {
    flex: 0 0 auto;
    min-height: 44px;
    padding: 10px 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.1;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.78),
      0 10px 24px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(18px) saturate(1.05);
  }

  .filter-pill-utility {
    padding-inline: 16px;
  }

  .top-actions {
    display: flex;
    gap: 10px;
    flex: 0 0 auto;
  }

  .icon-button {
    min-height: 40px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-weight: 600;
    backdrop-filter: blur(12px);
    border: 1px solid rgba(23, 25, 28, 0.08);
  }

  .icon-button-square {
    width: 40px;
    padding: 0;
    flex: 0 0 auto;
  }

  .icon-button svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  .viewport-chip {
    position: absolute;
    top: calc(72px + env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 24;
    padding: 11px 16px;
    border: 0;
    border-radius: 999px;
    background: #17191c;
    color: #f8f7f4;
    box-shadow: var(--shadow-strong);
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
  .filter-footer {
    display: flex;
    gap: 14px;
    align-items: center;
  }

  .panel-header,
  .sheet-header {
    justify-content: space-between;
  }

  .filter-footer {
    justify-content: flex-end;
  }

  .filter-footer.with-clear {
    justify-content: space-between;
  }

  .sheet-header {
    align-items: start;
    margin-bottom: 10px;
  }

  .sheet-header-brand {
    width: 100%;
    min-width: 0;
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
  }

  .sheet-header h1,
  .panel-header h2 {
    margin: 0;
  }

  .sheet-header h1 {
    font-size: clamp(1.18rem, 3vw, 1.6rem);
    line-height: 1.08;
  }

  .sheet-summary,
  .filter-summary {
    margin: 4px 0 0;
    color: var(--ink-soft);
    font-size: 0.88rem;
    line-height: 1.3;
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
    background: rgba(255, 255, 255, 0.68);
    border: 1px solid rgba(15, 23, 42, 0.08);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.78),
      0 10px 24px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(18px) saturate(1.05);
  }

  .ghost-chip-icon {
    width: 40px;
    height: 40px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
  }

  .ghost-chip-icon svg {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .ghost-chip-compact {
    min-height: 36px;
    padding: 8px 12px;
    font-size: 0.84rem;
  }

  .primary-button {
    min-height: 40px;
    padding: 10px 16px;
    background: #17191c;
    color: #f8f7f4;
    font-weight: 600;
  }

  .sheet-brand-mark {
    width: 42px;
    height: 42px;
    flex: 0 0 auto;
    margin-top: 2px;
    object-fit: contain;
  }

  .show-places-button {
    margin-left: auto;
  }

  .list-stack,
  .segment-row {
    display: grid;
    gap: 10px;
  }

  .segment-row button {
    min-height: 40px;
    padding: 10px 13px;
    white-space: nowrap;
    border: 1px solid rgba(23, 25, 28, 0.08);
  }

  .segment-row button.active {
    background: #17191c;
    color: #f8f7f4;
    border-color: transparent;
  }

  .segment-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
    align-items: stretch;
  }

  .review-segment {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.84);
    border: 1px solid rgba(23, 25, 28, 0.08);
    box-shadow: var(--shadow-soft);
  }

  .segment-row {
    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
    margin-bottom: 14px;
    align-items: center;
    min-width: 0;
  }

  .sort-icon {
    width: 12px;
    height: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
  }

  .sort-icon svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .sort-icon-tight {
    padding: 0;
    width: 12px;
  }

  .tray-row {
    gap: 4px;
  }

  .tray-pill {
    min-width: 0;
    min-height: 36px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex: 0 0 auto;
    border: 1px solid rgba(15, 23, 42, 0.08);
    background: rgba(255, 255, 255, 0.68);
    color: #111827;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.78),
      0 10px 24px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(18px) saturate(1.05);
    letter-spacing: -0.01em;
  }

  .tray-pill.active {
    background: rgba(17, 24, 39, 0.88);
    color: #f8fafc;
    border-color: transparent;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 14px 28px rgba(15, 23, 42, 0.18);
  }

  .tray-pill-price {
    min-width: 42px;
    font-weight: 700;
  }

  .tray-ratings {
    display: inline-flex;
    align-items: stretch;
    flex: 0 0 auto;
    overflow: hidden;
    border-radius: 999px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    background: rgba(255, 255, 255, 0.68);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.78),
      0 10px 24px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(18px) saturate(1.05);
  }

  .tray-ratings.active {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.78),
      0 12px 24px rgba(15, 23, 42, 0.1);
  }

  .review-segment {
    display: inline-flex;
    align-items: stretch;
    background: transparent;
  }

  .review-segment-option {
    min-height: 36px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 0;
    flex: 0 0 auto;
  }

  .review-segment-option + .review-segment-option {
    border-left: 1px solid rgba(15, 23, 42, 0.08);
  }

  .review-segment-option img {
    width: 22px;
    height: 22px;
    object-fit: contain;
    pointer-events: none;
  }

  .review-segment-option.tabelog img {
    width: 24px;
    height: 24px;
  }

  .review-segment-option.active.tabelog {
    background: rgba(245, 141, 10, 0.14);
  }

  .review-segment-option.active.google {
    background: rgba(66, 133, 244, 0.12);
  }

  .review-direction {
    min-height: 36px;
    min-width: 34px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    border: 0;
    border-left: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: #111827;
  }

  .review-direction.active {
    background: rgba(15, 23, 42, 0.05);
    color: #111827;
    border-color: rgba(15, 23, 42, 0.08);
    box-shadow: none;
  }

  .review-direction:disabled {
    opacity: 0.48;
  }

  .empty-state,
  .skeleton {
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.8);
    border: 1px solid var(--line);
  }

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
    .top-actions {
      gap: 8px;
      align-self: start;
    }

    .filter-pill,
    .icon-button {
      min-height: 40px;
      padding-inline: 12px;
    }

    .sheet-brand-mark {
      width: 38px;
      height: 38px;
    }

    .icon-button-square {
      width: 40px;
    }

    .floating-panel {
      left: 12px;
      right: 12px;
      top: calc(74px + env(safe-area-inset-top));
      padding: 14px;
    }

    .tray-row {
      gap: 3px;
    }

    .tray-pill {
      min-height: 34px;
      padding: 0 10px;
      font-size: 0.84rem;
    }

    .review-segment-option {
      min-height: 34px;
      padding-inline: 7px;
    }

    .review-segment-option img {
      width: 18px;
      height: 18px;
    }

    .review-segment-option.tabelog img {
      width: 20px;
      height: 20px;
    }
  }
</style>

