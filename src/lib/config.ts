export const DEFAULT_CENTER = { lat: 35.6900, lng: 139.7000 };
export const DEFAULT_RADIUS_METERS = 1200;
export const WALK_METERS_PER_MINUTE = 80;
export const CLOSING_SOON_MINUTES = 45;
export const SEARCH_REDRAW_METERS = 500;
export const MAP_STYLE_URL =
  (import.meta.env.PUBLIC_MAP_STYLE_URL as string | undefined) || 'https://demotiles.maplibre.org/style.json';

export const RADIUS_STEPS = [
  { label: '5m', meters: 400 },
  { label: '10m', meters: 800 },
  { label: '15m', meters: 1200 },
  { label: '20m', meters: 1600 },
  { label: '30m', meters: 2400 }
];
