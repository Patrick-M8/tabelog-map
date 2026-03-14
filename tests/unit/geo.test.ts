import { describe, expect, it } from 'vitest';

import { haversineDistanceMeters, isInsideBounds, walkMinutesFromDistance } from '../../src/lib/utils/geo';

describe('geo helpers', () => {
  it('computes a positive distance between nearby points', () => {
    const distance = haversineDistanceMeters(
      { lat: 35.6900, lng: 139.7000 },
      { lat: 35.6910, lng: 139.7020 }
    );
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(300);
  });

  it('translates distance into walk minutes', () => {
    expect(walkMinutesFromDistance(800)).toBe(10);
  });

  it('checks bounds membership', () => {
    expect(
      isInsideBounds(
        { lat: 35.69, lng: 139.7 },
        { north: 35.7, south: 35.68, east: 139.72, west: 139.69 }
      )
    ).toBe(true);
  });
});
