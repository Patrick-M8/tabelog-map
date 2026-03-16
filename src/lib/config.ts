export const DEFAULT_CENTER = { lat: 36.2048, lng: 138.2529 };
export const WALK_METERS_PER_MINUTE = 80;
export const CLOSING_SOON_MINUTES = 45;
export const OPENING_SOON_MINUTES = 15;
export const SEARCH_REDRAW_METERS = 500;
export const JAPAN_BOUNDS = [
  [122, 20],
  [154, 47]
] as const;

export const MAP_STYLE = {
  version: 8,
  sources: {
    cartoBase: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        'https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        'https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        'https://d.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    },
    cartoLabels: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
        'https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
        'https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
        'https://d.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  },
  layers: [
    {
      id: 'base',
      type: 'raster',
      source: 'cartoBase',
      paint: {
        'raster-opacity': 1
      }
    },
    {
      id: 'labels',
      type: 'raster',
      source: 'cartoLabels',
      paint: {
        'raster-opacity': 0.86
      }
    }
  ]
} as const;
