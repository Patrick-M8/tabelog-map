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
  import type {
    ActiveFilters,
    DisplayPlace,
    PlaceDetail,
    PlaceSummary,
    ReviewSource,
    SheetSnap,
    SortDirection,
    SortKey,
    SortMode
  } from '$lib/types';
  import { formatPriceRange, normalizePriceBand } from '$lib/utils/format';
  import { haversineDistanceMeters, isInsideBounds, walkMinutesFromDistance } from '$lib/utils/geo';
  import { derivePlaceStatus } from '$lib/utils/hours';
  import { countActiveFilters, summarizeFilters } from '$lib/utils/discovery';
  import { toAdvancedFilters } from '$lib/utils/filterScope';
  import { sortPlaces } from '$lib/utils/sort';
  import {
    DEFAULT_TRAY_SORT_STATE,
    setReviewSort,
    setStandardSort,
    traySortStateToSortKey
  } from '$lib/utils/traySort';

  type FilterSection = 'category' | 'walk' | 'price' | null;
  type TrayMenu = 'sort' | 'reviews' | null;
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
    hidePermanentlyClosed: false,
    maxWalkMinutes: null,
    priceBands: [],
    categoryKeys: []
  };
  const REFRESH_PROMPT_VISIBLE_MS = 2200;
  const REFRESH_PROMPT_FADE_MS = 320;

  const PRICE_BANDS = Array.from({ length: 5 }, (_, index) => '\u00A5'.repeat(index + 1));
  const WALK_MINUTE_OPTIONS = [5, 10, 15, 30];
  const CUISINE_PREVIEW_COUNT = 10;
  let innerWidth = 390;
  let sheetSnap: SheetSnap = 'peek';
  let sortMode: SortMode = DEFAULT_TRAY_SORT_STATE.sortMode;
  let sortDirection: SortDirection | null = DEFAULT_TRAY_SORT_STATE.sortDirection;
  let reviewSource: ReviewSource | null = DEFAULT_TRAY_SORT_STATE.reviewSource;
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
  let advancedFilters: ActiveFilters = { ...EMPTY_FILTERS };
  let advancedFilterCount = 0;
  let advancedFilterSummary = 'All nearby';
  let sortPillText = 'Best';
  let reviewsPillText = 'Reviews';
  let standardSortActive = false;
  let reviewSortActive = false;
  let pendingFilterSection: FilterSection = null;
  let categorySectionElement: HTMLElement | null = null;
  let walkSectionElement: HTMLElement | null = null;
  let priceSectionElement: HTMLElement | null = null;
  let cuisineExpanded = false;
  let visibleCuisineCategories: { key: string; label: string; count: number }[] = [];
  let trayMenu: TrayMenu = null;
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

  function currentTraySortState() {
    return {
      sortMode,
      sortDirection,
      reviewSource
    };
  }

  function closeTrayMenu() {
    trayMenu = null;
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    const target = event.target;

    if (!(target instanceof Element) || !target.closest('.tray-toolbar')) {
      closeTrayMenu();
    }
  }

  function toggleTrayMenu(nextMenu: Exclude<TrayMenu, null>) {
    trayMenu = trayMenu === nextMenu ? null : nextMenu;
  }

  function applyTraySortState(nextState: {
    sortMode: SortMode;
    sortDirection: SortDirection | null;
    reviewSource: ReviewSource | null;
  }) {
    sortMode = nextState.sortMode;
    sortDirection = nextState.sortDirection;
    reviewSource = nextState.reviewSource;
    closeTrayMenu();
    queueRefreshPrompt();
  }

  function setStandardSortOption(nextMode: Extract<SortMode, 'best' | 'distance' | 'price'>, nextDirection: SortDirection | null = null) {
    applyTraySortState(setStandardSort(currentTraySortState(), nextMode, nextDirection));
  }

  function setReviewSourceOption(nextSource: ReviewSource) {
    applyTraySortState(setReviewSort(currentTraySortState(), nextSource));
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

  function setWalkMinutes(minutes: number) {
    updateFilters({
      ...activeFilters,
      maxWalkMinutes: activeFilters.maxWalkMinutes === minutes ? null : minutes
    });
  }

  async function openFilters(section: FilterSection = null) {
    closeTrayMenu();
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
    closeTrayMenu();
    void navigateUiState(currentBrowseState({ sheetSnap: desktop ? sheetSnap : 'mid' }), { replace: true });
  }

  function clearAdvancedFilters() {
    cuisineExpanded = false;
    updateFilters({
      ...activeFilters,
      closingSoon: false,
      hidePermanentlyClosed: false,
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

  function toggleHidePermanentlyClosedFilter() {
    updateFilters({
      ...activeFilters,
      hidePermanentlyClosed: !activeFilters.hidePermanentlyClosed
    });
  }

  function resetAvailabilityFilters() {
    updateFilters({
      ...activeFilters,
      closingSoon: false,
      hidePermanentlyClosed: false
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

    document.addEventListener('pointerdown', handleDocumentPointerDown);
  });

  onDestroy(() => {
    clearRefreshPromptTimers();
    if (browser) {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
    }
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
  $: advancedFilters = toAdvancedFilters(activeFilters);
  $: advancedFilterCount = countActiveFilters(advancedFilters);
  $: advancedFilterSummary = summarizeFilters(advancedFilters);
  $: sortPillText =
    sortMode === 'distance'
      ? sortDirection === 'desc'
        ? 'Distance ↓'
        : 'Distance ↑'
      : sortMode === 'price'
        ? sortDirection === 'desc'
          ? 'Price ↓'
          : 'Price ↑'
        : sortMode === 'best'
          ? 'Best'
          : 'Sort';
  $: reviewsPillText =
    sortMode === 'reviews' && reviewSource ? `${reviewSource === 'tabelog' ? 'Tabelog' : 'Google'} ★` : 'Reviews';
  $: standardSortActive = sortMode === 'distance' || sortMode === 'price';
  $: reviewSortActive = sortMode === 'reviews' && reviewSource !== null;
  $: sortKey = traySortStateToSortKey({ sortMode, sortDirection, reviewSource });
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
    .filter((place) => (activeFilters.hidePermanentlyClosed ? place.closure.state !== 'permanentlyClosed' : true))
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
        sheetSnap: 'peek',
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

<svelte:window
  bind:innerWidth
  on:keydown={(event) => {
    if (event.key === 'Escape') {
      closeTrayMenu();
    }
  }}
/>

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
      <div class="top-filter-row" aria-label="Filters">
        <button
          type="button"
          class="filter-pill filter-pill-filters"
          class:active={advancedFilterCount > 0}
          on:click={() => openFilters()}
        >
          <span>Filters</span>
          {#if advancedFilterCount > 0}
            <span class="filter-count-badge" aria-label={`${advancedFilterCount} active filters`}>{advancedFilterCount}</span>
          {/if}
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

        {#if advancedFilterCount > 0}
          <p class="filter-summary">{advancedFilterSummary}</p>
        {/if}

        <section class="filter-section">
          <div class="section-heading">
            <h3>Availability</h3>
            {#if activeFilters.closingSoon || activeFilters.hidePermanentlyClosed}
              <button type="button" class="text-button" on:click={resetAvailabilityFilters}>
                Reset
              </button>
            {/if}
          </div>
          <div class="token-wrap">
            <button
              type="button"
              class:active={activeFilters.closingSoon}
              on:click={toggleClosingSoonFilter}
            >
              Closing soon
            </button>
            <button
              type="button"
              class:active={activeFilters.hidePermanentlyClosed}
              on:click={toggleHidePermanentlyClosedFilter}
            >
              Hide permanently closed
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
            {#each visibleCuisineCategories as category}
              <button type="button" class:active={activeFilters.categoryKeys.includes(category.key)} on:click={() => toggleCategory(category.key)}>
                {category.label}
              </button>
            {/each}
          </div>
          {#if cuisineExpanded || availableCategories.length > visibleCuisineCategories.length}
            <button type="button" class="text-button" on:click={() => (cuisineExpanded = !cuisineExpanded)}>
              {cuisineExpanded ? 'Show less' : `Show ${availableCategories.length - visibleCuisineCategories.length} more`}
            </button>
          {/if}
        </section>

        <div class="filter-footer" class:with-clear={advancedFilterCount > 0}>
          {#if advancedFilterCount > 0}
            <button type="button" class="ghost-chip" on:click={clearAdvancedFilters}>Clear all</button>
          {/if}
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
          <div class="sheet-top-zone" data-sheet-drag-zone>
            <div class="sheet-header">
              <div>
                <h1>{selectedPlace?.station ?? 'Restaurants near the current map'}</h1>
                <p class="sheet-meta">{placesInViewLabel(sortedPlaces.length, visiblePlaces.length)}</p>
                {#if advancedFilterCount > 0}
                  <p class="sheet-summary">{advancedFilterSummary}</p>
                {/if}
              </div>
              <button type="button" class="ghost-chip" on:click={() => openFilters()}>
                Filters{#if advancedFilterCount > 0} {advancedFilterCount}{/if}
              </button>
            </div>

            <div class="tray-toolbar">
              <div class="segment-row segment-row-toolbar">
                <button type="button" class="toolbar-pill" class:active={activeFilters.openNow} on:click={toggleOpenNowFilter}>
                  <span class="toolbar-pill-label">Open</span>
                </button>
                <button
                  type="button"
                  class="toolbar-pill"
                  class:active={standardSortActive}
                  aria-haspopup="menu"
                  aria-expanded={trayMenu === 'sort'}
                  on:click={() => toggleTrayMenu('sort')}
                >
                  <span class="toolbar-pill-label">{sortPillText}</span>
                  <span class="toolbar-pill-chevron" aria-hidden="true">
                    <svg viewBox="0 0 12 12">
                      <path d="M3.25 4.5 6 7.25 8.75 4.5" />
                    </svg>
                  </span>
                </button>
                <button
                  type="button"
                  class="toolbar-pill toolbar-pill-reviews"
                  class:active={reviewSortActive}
                  class:provider-tabelog={sortMode === 'reviews' && reviewSource === 'tabelog'}
                  class:provider-google={sortMode === 'reviews' && reviewSource === 'google'}
                  aria-haspopup="menu"
                  aria-expanded={trayMenu === 'reviews'}
                  on:click={() => toggleTrayMenu('reviews')}
                >
                  <span class="toolbar-pill-label">{reviewsPillText}</span>
                  <span class="toolbar-pill-chevron" aria-hidden="true">
                    <svg viewBox="0 0 12 12">
                      <path d="M3.25 4.5 6 7.25 8.75 4.5" />
                    </svg>
                  </span>
                </button>
              </div>

              {#if trayMenu === 'sort'}
                <div class="tray-menu tray-menu-sort" role="menu" aria-label="Sort options">
                  <button type="button" class:active={sortMode === 'best'} on:click={() => setStandardSortOption('best')}>Best</button>
                  <button
                    type="button"
                    class:active={sortMode === 'distance' && sortDirection === 'asc'}
                    on:click={() => setStandardSortOption('distance', 'asc')}
                  >
                    Distance ↑
                  </button>
                  <button
                    type="button"
                    class:active={sortMode === 'distance' && sortDirection === 'desc'}
                    on:click={() => setStandardSortOption('distance', 'desc')}
                  >
                    Distance ↓
                  </button>
                  <button
                    type="button"
                    class:active={sortMode === 'price' && sortDirection === 'asc'}
                    on:click={() => setStandardSortOption('price', 'asc')}
                  >
                    Price ↑
                  </button>
                  <button
                    type="button"
                    class:active={sortMode === 'price' && sortDirection === 'desc'}
                    on:click={() => setStandardSortOption('price', 'desc')}
                  >
                    Price ↓
                  </button>
                </div>
              {:else if trayMenu === 'reviews'}
                <div class="tray-menu tray-menu-reviews" role="menu" aria-label="Review sort options">
                  <button
                    type="button"
                    class="review-menu-option review-menu-option-tabelog"
                    class:active={sortMode === 'reviews' && reviewSource === 'tabelog'}
                    on:click={() => setReviewSourceOption('tabelog')}
                  >
                    Tabelog ★
                  </button>
                  <button
                    type="button"
                    class="review-menu-option review-menu-option-google"
                    class:active={sortMode === 'reviews' && reviewSource === 'google'}
                    on:click={() => setReviewSourceOption('google')}
                  >
                    Google ★
                  </button>
                </div>
              {/if}
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
              {#if advancedFilterCount > 0}
                <p class="sheet-summary">{advancedFilterSummary}</p>
              {/if}
            </div>
            <button type="button" class="ghost-chip ghost-chip-compact" on:click={closeFilters}>Done</button>
          </div>

          <div class="filter-section-stack">
            <section class="filter-section">
              <div class="section-heading">
                <h3>Availability</h3>
              </div>
              <div class="token-wrap">
                <button
                  type="button"
                  class:active={activeFilters.closingSoon}
                  on:click={toggleClosingSoonFilter}
                >
                  Closing soon
                </button>
                <button
                  type="button"
                  class:active={activeFilters.hidePermanentlyClosed}
                  on:click={toggleHidePermanentlyClosedFilter}
                >
                  Hide permanently closed
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
                {#each visibleCuisineCategories as category}
                  <button type="button" class:active={activeFilters.categoryKeys.includes(category.key)} on:click={() => toggleCategory(category.key)}>
                    {category.label}
                  </button>
                {/each}
              </div>
              {#if cuisineExpanded || availableCategories.length > visibleCuisineCategories.length}
                <button type="button" class="text-button" on:click={() => (cuisineExpanded = !cuisineExpanded)}>
                  {cuisineExpanded ? 'Show less' : `Show ${availableCategories.length - visibleCuisineCategories.length} more`}
                </button>
              {/if}
            </section>
          </div>

          <div class="filter-footer filter-footer-sticky" class:with-clear={advancedFilterCount > 0}>
            {#if advancedFilterCount > 0}
              <button type="button" class="ghost-chip ghost-chip-compact" on:click={clearAdvancedFilters}>Clear all</button>
            {/if}
            <button type="button" class="primary-button" on:click={closeFilters}>Show {sortedPlaces.length} places</button>
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
        <div class="sheet-top-zone sheet-top-zone-mobile" data-sheet-drag-zone>
          <div class="sheet-header sheet-header-mobile-compact">
            <div>
              <h1>Restaurants nearby</h1>
              <p class="sheet-meta">{placesInViewLabel(sortedPlaces.length, visiblePlaces.length)}</p>
              {#if advancedFilterCount > 0}
                <p class="sheet-summary">{advancedFilterSummary}</p>
              {/if}
            </div>
          </div>

          <div class="tray-toolbar">
            <div class="segment-row segment-row-mobile segment-row-toolbar">
              <button type="button" class="toolbar-pill" class:active={activeFilters.openNow} on:click={toggleOpenNowFilter}>
                <span class="toolbar-pill-label">Open</span>
              </button>
              <button
                type="button"
                class="toolbar-pill"
                class:active={standardSortActive}
                aria-haspopup="menu"
                aria-expanded={trayMenu === 'sort'}
                on:click={() => toggleTrayMenu('sort')}
              >
                <span class="toolbar-pill-label">{sortPillText}</span>
                <span class="toolbar-pill-chevron" aria-hidden="true">
                  <svg viewBox="0 0 12 12">
                    <path d="M3.25 4.5 6 7.25 8.75 4.5" />
                  </svg>
                </span>
              </button>
              <button
                type="button"
                class="toolbar-pill toolbar-pill-reviews"
                class:active={reviewSortActive}
                class:provider-tabelog={sortMode === 'reviews' && reviewSource === 'tabelog'}
                class:provider-google={sortMode === 'reviews' && reviewSource === 'google'}
                aria-haspopup="menu"
                aria-expanded={trayMenu === 'reviews'}
                on:click={() => toggleTrayMenu('reviews')}
              >
                <span class="toolbar-pill-label">{reviewsPillText}</span>
                <span class="toolbar-pill-chevron" aria-hidden="true">
                  <svg viewBox="0 0 12 12">
                    <path d="M3.25 4.5 6 7.25 8.75 4.5" />
                  </svg>
                </span>
              </button>
            </div>

            {#if trayMenu === 'sort'}
              <div class="tray-menu tray-menu-sort" role="menu" aria-label="Sort options">
                <button type="button" class:active={sortMode === 'best'} on:click={() => setStandardSortOption('best')}>Best</button>
                <button
                  type="button"
                  class:active={sortMode === 'distance' && sortDirection === 'asc'}
                  on:click={() => setStandardSortOption('distance', 'asc')}
                >
                  Distance ↑
                </button>
                <button
                  type="button"
                  class:active={sortMode === 'distance' && sortDirection === 'desc'}
                  on:click={() => setStandardSortOption('distance', 'desc')}
                >
                  Distance ↓
                </button>
                <button
                  type="button"
                  class:active={sortMode === 'price' && sortDirection === 'asc'}
                  on:click={() => setStandardSortOption('price', 'asc')}
                >
                  Price ↑
                </button>
                <button
                  type="button"
                  class:active={sortMode === 'price' && sortDirection === 'desc'}
                  on:click={() => setStandardSortOption('price', 'desc')}
                >
                  Price ↓
                </button>
              </div>
            {:else if trayMenu === 'reviews'}
              <div class="tray-menu tray-menu-reviews" role="menu" aria-label="Review sort options">
                <button
                  type="button"
                  class="review-menu-option review-menu-option-tabelog"
                  class:active={sortMode === 'reviews' && reviewSource === 'tabelog'}
                  on:click={() => setReviewSourceOption('tabelog')}
                >
                  Tabelog ★
                </button>
                <button
                  type="button"
                  class="review-menu-option review-menu-option-google"
                  class:active={sortMode === 'reviews' && reviewSource === 'google'}
                  on:click={() => setReviewSourceOption('google')}
                >
                  Google ★
                </button>
              </div>
            {/if}
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
  .viewport-chip,
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
  .token-wrap button,
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

  .top-filter-row {
    min-width: 0;
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0 2px 2px 0;
  }

  .top-filter-row::-webkit-scrollbar {
    display: none;
  }

  .filter-pill {
    flex: 0 0 auto;
    min-height: 40px;
    padding: 9px 13px;
    font-weight: 600;
    line-height: 1.1;
    backdrop-filter: blur(12px);
    border: 1px solid rgba(23, 25, 28, 0.08);
  }

  .filter-pill.active {
    background: rgba(23, 25, 28, 0.08);
    color: var(--ink);
    border-color: rgba(23, 25, 28, 0.14);
  }

  .filter-pill-filters {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 8px 12px;
    font-size: 0.84rem;
  }

  .filter-count-badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    display: inline-grid;
    place-items: center;
    background: rgba(23, 25, 28, 0.1);
    color: var(--ink);
    font-size: 0.72rem;
    line-height: 1;
    font-weight: 700;
  }

  .filter-pill.active .filter-count-badge {
    background: rgba(23, 25, 28, 0.12);
    color: var(--ink);
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
    top: calc(72px + env(safe-area-inset-top));
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
    margin-bottom: 10px;
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
    min-height: 40px;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.78);
    border: 1px solid rgba(23, 25, 28, 0.08);
    box-shadow: none;
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
    gap: 10px;
  }

  .token-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .token-wrap button,
  .segment-row button {
    min-height: 40px;
    padding: 10px 13px;
    white-space: nowrap;
    border: 1px solid rgba(23, 25, 28, 0.08);
  }

  .token-wrap button.active,
  .segment-row button.active {
    background: #17191c;
    color: #f8f7f4;
    border-color: transparent;
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
    gap: 8px;
    margin-bottom: 12px;
    align-items: stretch;
  }

  .sheet-top-zone {
    padding-bottom: 4px;
  }

  .tray-toolbar {
    position: relative;
    display: grid;
    gap: 8px;
  }

  .segment-row-toolbar {
    flex-wrap: nowrap;
    gap: 6px;
    margin-bottom: 0;
  }

  .toolbar-pill {
    min-width: 0;
    flex: 1 1 0;
    min-height: 38px;
    padding: 8px 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    white-space: nowrap;
    border-radius: 999px;
    border: 1px solid rgba(23, 25, 28, 0.08);
    background: rgba(255, 255, 255, 0.84);
    box-shadow: var(--shadow-soft);
  }

  .toolbar-pill.active {
    background: rgba(23, 25, 28, 0.08);
    border-color: rgba(23, 25, 28, 0.14);
    color: var(--ink);
  }

  .toolbar-pill.provider-tabelog.active {
    background: rgba(125, 97, 72, 0.14);
    border-color: rgba(125, 97, 72, 0.18);
    color: #6f543d;
  }

  .toolbar-pill.provider-google.active {
    background: rgba(85, 96, 111, 0.14);
    border-color: rgba(85, 96, 111, 0.18);
    color: #485260;
  }

  .toolbar-pill-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toolbar-pill-chevron {
    width: 12px;
    height: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .toolbar-pill-chevron svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tray-menu {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: 8;
    display: grid;
    gap: 6px;
    padding: 8px;
    border-radius: 18px;
    background: rgba(247, 246, 243, 0.96);
    backdrop-filter: blur(18px);
    border: 1px solid rgba(255, 255, 255, 0.78);
    box-shadow: var(--shadow-strong);
  }

  .tray-menu button {
    min-height: 38px;
    padding: 10px 12px;
    justify-content: flex-start;
    border-radius: 14px;
    border: 1px solid rgba(23, 25, 28, 0.08);
    background: rgba(255, 255, 255, 0.88);
    box-shadow: none;
  }

  .tray-menu button.active {
    background: rgba(23, 25, 28, 0.08);
    border-color: rgba(23, 25, 28, 0.14);
    color: var(--ink);
  }

  .review-menu-option-tabelog {
    color: #7d6148;
  }

  .review-menu-option-google {
    color: #55606f;
  }

  .tray-menu .review-menu-option-tabelog.active {
    background: rgba(125, 97, 72, 0.14);
    border-color: rgba(125, 97, 72, 0.18);
    color: #6f543d;
  }

  .tray-menu .review-menu-option-google.active {
    background: rgba(85, 96, 111, 0.14);
    border-color: rgba(85, 96, 111, 0.18);
    color: #485260;
  }

  .sheet-meta {
    margin: 3px 0 0;
    color: rgba(23, 25, 28, 0.58);
    font-size: 0.8rem;
    line-height: 1.25;
  }

  .sheet-header-mobile-compact {
    margin-bottom: 8px;
  }

  .sheet-header-mobile-compact h1 {
    font-size: 1.1rem;
    line-height: 1.08;
  }

  .mobile-filter-shell {
    display: grid;
    gap: 10px;
    padding-bottom: 4px;
  }

  .sheet-header-sticky {
    position: sticky;
    top: -1px;
    z-index: 3;
    padding: 2px 0 10px;
    margin-bottom: 0;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--sheet-bg) 96%, white 4%) 0%,
      color-mix(in srgb, var(--sheet-bg) 90%, white 10%) 78%,
      rgba(247, 246, 243, 0) 100%
    );
    backdrop-filter: blur(14px);
  }

  .sheet-header-mobile h1 {
    font-size: 1.14rem;
    line-height: 1.08;
  }

  .filter-section-stack {
    display: grid;
    gap: 10px;
    padding-bottom: 86px;
  }

  .filter-footer-sticky {
    position: sticky;
    bottom: calc(-16px - env(safe-area-inset-bottom));
    z-index: 3;
    padding: 12px 0 calc(2px + env(safe-area-inset-bottom));
    margin-top: -72px;
    background: linear-gradient(180deg, rgba(247, 246, 243, 0) 0%, rgba(247, 246, 243, 0.95) 26%, rgba(247, 246, 243, 0.99) 100%);
    backdrop-filter: blur(14px);
  }

  .filter-footer {
    justify-content: flex-end;
  }

  .filter-footer.with-clear {
    justify-content: space-between;
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
    .top-actions {
      gap: 8px;
      align-self: start;
    }

    .top-filter-row {
      gap: 6px;
    }

    .filter-pill,
    .icon-button {
      min-height: 40px;
      padding-inline: 12px;
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

    .sheet-header-mobile-compact {
      margin-bottom: 6px;
    }

    .list-stack {
      gap: 10px;
    }

    .segment-row-mobile {
      flex-wrap: nowrap;
      gap: 6px;
      overflow: visible;
      padding-bottom: 0;
    }

    .toolbar-pill {
      min-height: 36px;
      padding: 8px 10px;
      font-size: 0.8rem;
    }

    .tray-menu button {
      min-height: 36px;
      padding: 9px 10px;
      font-size: 0.82rem;
    }
  }
</style>

