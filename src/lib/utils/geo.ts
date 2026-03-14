import { WALK_METERS_PER_MINUTE } from '$lib/config';
import type { MapBounds } from '$lib/types';

const EARTH_RADIUS_METERS = 6371000;

const toRadians = (value: number) => (value * Math.PI) / 180;

export function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const part =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(part));
}

export function walkMinutesFromDistance(distanceMeters: number) {
  return Math.max(1, Math.round(distanceMeters / WALK_METERS_PER_MINUTE));
}

export function isInsideBounds(point: { lat: number; lng: number }, bounds: MapBounds | null) {
  if (!bounds) {
    return true;
  }

  return (
    point.lat <= bounds.north &&
    point.lat >= bounds.south &&
    point.lng <= bounds.east &&
    point.lng >= bounds.west
  );
}
