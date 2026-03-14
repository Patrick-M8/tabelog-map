export const DEFAULT_CENTER = { lat: 36.2048, lng: 138.2529 };
export const WALK_METERS_PER_MINUTE = 80;
export const CLOSING_SOON_MINUTES = 45;
export const SEARCH_REDRAW_METERS = 500;
export const JAPAN_BOUNDS = [
  [122, 20],
  [154, 47]
] as const;

export const MAP_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  },
  layers: [
    {
      id: 'base',
      type: 'raster',
      source: 'carto'
    }
  ]
} as const;
