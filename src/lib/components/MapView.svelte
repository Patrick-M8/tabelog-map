<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import maplibregl, { type GeoJSONSource, type Map } from 'maplibre-gl';

  import { DEFAULT_CENTER, JAPAN_BOUNDS, MAP_STYLE } from '$lib/config';
  import type { DisplayPlace } from '$lib/types';

  export let places: DisplayPlace[] = [];
  export let selectedPlaceId: string | null = null;
  export let userLocation: { lat: number; lng: number } | null = null;
  export let focusTarget: { lat: number; lng: number; zoom?: number; token: string } | null = null;
  export let desktop = false;

  const dispatch = createEventDispatcher<{
    moveend: {
      center: { lat: number; lng: number };
      bounds: { north: number; south: number; east: number; west: number };
    };
    select: { id: string };
  }>();

  let container: HTMLDivElement;
  let map: Map | null = null;
  let lastFocusToken = '';

  function asFeatureCollection() {
    return {
      type: 'FeatureCollection' as const,
      features: places.map((place) => ({
        type: 'Feature' as const,
        properties: {
          id: place.id,
          state: place.status.state
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [place.lng, place.lat]
        }
      }))
    };
  }

  function emitMove() {
    if (!map) {
      return;
    }

    const center = map.getCenter();
    const bounds = map.getBounds();
    dispatch('moveend', {
      center: { lat: center.lat, lng: center.lng },
      bounds: {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      }
    });
  }

  function ensureLayers() {
    if (!map || map.getSource('places')) {
      return;
    }

    map.addSource('places', {
      type: 'geojson',
      data: asFeatureCollection(),
      cluster: true,
      clusterRadius: 44,
      clusterMaxZoom: 13
    });

    map.addSource('user-point', {
      type: 'geojson',
      data: userLocation
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: [userLocation.lng, userLocation.lat] }
              }
            ]
          }
        : { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'cluster-halo',
      type: 'circle',
      source: 'places',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': 'rgba(23, 25, 28, 0.12)',
        'circle-radius': ['step', ['get', 'point_count'], 28, 20, 32, 40, 38]
      }
    });

    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'places',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#17191c',
        'circle-radius': ['step', ['get', 'point_count'], 18, 20, 22, 40, 26],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f7f6f3'
      }
    });

    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'places',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Open Sans Bold'],
        'text-size': 12
      },
      paint: {
        'text-color': '#f7f6f3'
      }
    });

    map.addLayer({
      id: 'point-halo',
      type: 'circle',
      source: 'places',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 12,
        'circle-color': [
          'match',
          ['get', 'state'],
          'open',
          'rgba(47, 125, 87, 0.18)',
          'closingSoon',
          'rgba(200, 100, 59, 0.2)',
          'rgba(140, 145, 153, 0.18)'
        ]
      }
    });

    map.addLayer({
      id: 'points',
      type: 'circle',
      source: 'places',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 6.5,
        'circle-color': [
          'match',
          ['get', 'state'],
          'open',
          '#2f7d57',
          'closingSoon',
          '#c8643b',
          '#8c9199'
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f7f6f3'
      }
    });

    map.addLayer({
      id: 'selected-point',
      type: 'circle',
      source: 'places',
      filter: ['==', ['get', 'id'], selectedPlaceId ?? ''],
      paint: {
        'circle-radius': 17,
        'circle-color': 'rgba(247, 246, 243, 0.95)',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#c8643b'
      }
    });

    map.addLayer({
      id: 'selected-point-core',
      type: 'circle',
      source: 'places',
      filter: ['==', ['get', 'id'], selectedPlaceId ?? ''],
      paint: {
        'circle-radius': 7.5,
        'circle-color': '#17191c',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f7f6f3'
      }
    });

    map.addLayer({
      id: 'user-point-layer',
      type: 'circle',
      source: 'user-point',
      paint: {
        'circle-radius': 7,
        'circle-color': '#2f7d57',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#f7f6f3'
      }
    });

    map.on('click', 'clusters', async (event) => {
      const source = map?.getSource('places') as GeoJSONSource | undefined;
      const clusterFeature = event.features?.[0];
      const clusterId = clusterFeature?.properties?.cluster_id;
      if (!source || clusterId === undefined || event.lngLat == null) {
        return;
      }

      const zoom = await source.getClusterExpansionZoom(clusterId);
      map?.easeTo({ center: event.lngLat, zoom, duration: 320 });
    });

    map.on('click', 'points', (event) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.id;
      if (typeof id === 'string') {
        dispatch('select', { id });
      }
    });

    ['clusters', 'points'].forEach((layerId) => {
      map?.on('mouseenter', layerId, () => {
        if (map) {
          map.getCanvas().style.cursor = 'pointer';
        }
      });
      map?.on('mouseleave', layerId, () => {
        if (map) {
          map.getCanvas().style.cursor = '';
        }
      });
    });
  }

  function syncSources() {
    if (!map) {
      return;
    }

    const placeSource = map.getSource('places') as GeoJSONSource | undefined;
    placeSource?.setData(asFeatureCollection());
    map.setFilter('selected-point', ['==', ['get', 'id'], selectedPlaceId ?? '']);
    map.setFilter('selected-point-core', ['==', ['get', 'id'], selectedPlaceId ?? '']);

    const userPointSource = map.getSource('user-point') as GeoJSONSource | undefined;
    userPointSource?.setData(
      userLocation
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: [userLocation.lng, userLocation.lat] }
              }
            ]
          }
        : { type: 'FeatureCollection', features: [] }
    );
  }

  onMount(() => {
    map = new maplibregl.Map({
      container,
      style: MAP_STYLE as never,
      center: userLocation ? [userLocation.lng, userLocation.lat] : [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: userLocation ? 13.6 : 4.8,
      minZoom: 4.6,
      maxZoom: 18,
      maxBounds: JAPAN_BOUNDS as unknown as [maplibregl.LngLatLike, maplibregl.LngLatLike],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false
    });

    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    if (desktop) {
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }), 'bottom-right');
    }

    map.on('load', () => {
      ensureLayers();
      syncSources();
      emitMove();
    });
    map.on('moveend', emitMove);

    return () => {
      map?.remove();
      map = null;
    };
  });

  onDestroy(() => {
    map?.remove();
  });

  $: if (map?.isStyleLoaded()) {
    syncSources();
  }

  $: if (map && focusTarget && focusTarget.token !== lastFocusToken) {
    lastFocusToken = focusTarget.token;
    map.easeTo({
      center: [focusTarget.lng, focusTarget.lat],
      zoom: focusTarget.zoom ?? Math.max(map.getZoom(), 14.2),
      duration: 360,
      essential: true
    });
  }
</script>

<div bind:this={container} class="map-shell" aria-label="Restaurant map"></div>

<style>
  .map-shell {
    position: absolute;
    inset: 0;
  }

  :global(.maplibregl-canvas) {
    filter: saturate(0.92) contrast(1.02);
  }

  :global(.maplibregl-ctrl-group) {
    border-radius: 18px;
    overflow: hidden;
    box-shadow: 0 12px 24px rgba(17, 24, 39, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.7);
  }

  :global(.maplibregl-ctrl-group button) {
    width: 42px;
    height: 42px;
  }

  :global(.maplibregl-ctrl-bottom-right) {
    bottom: calc(220px + env(safe-area-inset-bottom));
    right: calc(12px + env(safe-area-inset-right));
  }

  @media (min-width: 960px) {
    :global(.maplibregl-ctrl-bottom-right) {
      bottom: calc(24px + env(safe-area-inset-bottom));
    }
  }
</style>
