<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import maplibregl, { type GeoJSONSource, type Map } from 'maplibre-gl';

  import { MAP_STYLE_URL } from '$lib/config';
  import type { DisplayPlace } from '$lib/types';

  export let places: DisplayPlace[] = [];
  export let selectedPlaceId: string | null = null;
  export let userLocation: { lat: number; lng: number } | null = null;
  export let focusTarget: { lat: number; lng: number; zoom?: number; token: string } | null = null;
  export let radiusMeters = 1200;
  export let clustersEnabled = true;
  export let heatmapEnabled = false;

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
          grade: place.consensusGrade,
          state: place.status.state
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [place.lng, place.lat]
        }
      }))
    };
  }

  function circlePolygon(center: { lat: number; lng: number }, meters: number) {
    const steps = 64;
    const coordinates = [];
    for (let index = 0; index <= steps; index += 1) {
      const bearing = (index / steps) * (Math.PI * 2);
      const dx = (meters / 111320) * Math.cos(bearing);
      const dy = (meters / (111320 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(bearing);
      coordinates.push([center.lng + dy, center.lat + dx]);
    }

    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [coordinates]
          },
          properties: {}
        }
      ]
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

    map.addSource('user-ring', {
      type: 'geojson',
      data: userLocation ? circlePolygon(userLocation, radiusMeters) : { type: 'FeatureCollection', features: [] }
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
      id: 'user-ring-fill',
      type: 'fill',
      source: 'user-ring',
      paint: {
        'fill-color': '#f6c177',
        'fill-opacity': 0.1
      }
    });

    map.addLayer({
      id: 'user-ring-line',
      type: 'line',
      source: 'user-ring',
      paint: {
        'line-color': '#c97033',
        'line-width': 2,
        'line-opacity': 0.65
      }
    });

    map.addLayer({
      id: 'heat',
      type: 'heatmap',
      source: 'places',
      maxzoom: 15,
      layout: {
        visibility: heatmapEnabled ? 'visible' : 'none'
      },
      paint: {
        'heatmap-weight': 1,
        'heatmap-radius': 24,
        'heatmap-intensity': 0.75,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(246,193,119,0)',
          0.4,
          '#f6c177',
          1,
          '#c97033'
        ]
      }
    });

    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'places',
      filter: ['has', 'point_count'],
      layout: {
        visibility: clustersEnabled ? 'visible' : 'none'
      },
      paint: {
        'circle-color': '#1f2a2f',
        'circle-radius': ['step', ['get', 'point_count'], 18, 20, 22, 40, 26],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f6f1e8'
      }
    });

    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'places',
      filter: ['has', 'point_count'],
      layout: {
        visibility: clustersEnabled ? 'visible' : 'none',
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Open Sans Bold'],
        'text-size': 12
      },
      paint: {
        'text-color': '#f6f1e8'
      }
    });

    map.addLayer({
      id: 'points',
      type: 'circle',
      source: 'places',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 8,
        'circle-color': [
          'match',
          ['get', 'state'],
          'open',
          '#3d8c59',
          'closingSoon',
          '#c97033',
          '#7b7b74'
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f6f1e8'
      }
    });

    map.addLayer({
      id: 'selected-point',
      type: 'circle',
      source: 'places',
      filter: ['==', ['get', 'id'], selectedPlaceId ?? ''],
      paint: {
        'circle-radius': 14,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#1f2a2f'
      }
    });

    map.addLayer({
      id: 'user-point-layer',
      type: 'circle',
      source: 'user-point',
      paint: {
        'circle-radius': 7,
        'circle-color': '#1f2a2f',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#f6f1e8'
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
    map.setLayoutProperty('clusters', 'visibility', clustersEnabled ? 'visible' : 'none');
    map.setLayoutProperty('cluster-count', 'visibility', clustersEnabled ? 'visible' : 'none');
    map.setLayoutProperty('heat', 'visibility', heatmapEnabled ? 'visible' : 'none');

    const userRingSource = map.getSource('user-ring') as GeoJSONSource | undefined;
    const userPointSource = map.getSource('user-point') as GeoJSONSource | undefined;

    userRingSource?.setData(
      userLocation ? circlePolygon(userLocation, radiusMeters) : { type: 'FeatureCollection', features: [] }
    );
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
      style: MAP_STYLE_URL,
      center: userLocation ? [userLocation.lng, userLocation.lat] : [139.7000, 35.6900],
      zoom: userLocation ? 13.6 : 12.3,
      attributionControl: false
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }), 'bottom-right');

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

  :global(.maplibregl-ctrl-bottom-right) {
    bottom: calc(28px + env(safe-area-inset-bottom));
    right: calc(12px + env(safe-area-inset-right));
  }
</style>
