import type { PlaceDetail, PlaceSummary, PopularHub } from '$lib/types';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function loadPlaceSummary() {
  return fetchJson<PlaceSummary[]>('/data/places-summary.min.json');
}

export function loadPlaceDetails() {
  return fetchJson<Record<string, PlaceDetail>>('/data/places-detail.min.json');
}

export function loadPopularHubs() {
  return fetchJson<PopularHub[]>('/data/popular-hubs.min.json');
}
