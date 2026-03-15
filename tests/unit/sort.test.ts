import { describe, expect, it } from 'vitest';

import { sortPlaces } from '../../src/lib/utils/sort';
import type { DisplayPlace } from '../../src/lib/types';

const makePlace = (id: string, overrides: Partial<DisplayPlace>): DisplayPlace => ({
  id,
  placeId: id,
  nameEn: id,
  nameJp: id,
  lat: 35.69,
  lng: 139.7,
  region: 'TOKYO',
  station: 'Shinjuku',
  area: 'Tokyo Shinjuku',
  category: { key: 'ramen', label: 'Ramen', labelJp: 'ラーメン' },
  subCategories: [],
  priceBand: '¥¥',
  priceBucket: 2,
  weeklyTimeline: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  hoursConfidence: 'medium',
  freshnessUpdatedAt: '2026-03-14T12:00:00+09:00',
  consensusScore: 0.1,
  consensusGrade: 'C',
  tabelog: { score: 3.8, reviews: 100 },
  google: { score: 4.2, reviews: 100 },
  sourceLinks: { tabelog: null, google: null },
  reserveUrl: null,
  callPhone: null,
  advisories: [],
  badges: [],
  distanceMeters: 600,
  walkMinutes: 8,
  status: {
    state: 'open',
    label: 'Open',
    detail: '09:00 - 18:00',
    closesAt: '18:00',
    opensAt: null,
    lastOrderAt: null
  },
  ...overrides
});

describe('sortPlaces', () => {
  it('prefers stronger nearby open places for best sort', () => {
    const sorted = sortPlaces(
      [
        makePlace('far-a', { consensusGrade: 'A', distanceMeters: 1400 }),
        makePlace('near-b', { consensusGrade: 'B', distanceMeters: 400 }),
        makePlace('closed-a', {
          consensusGrade: 'A',
          distanceMeters: 300,
          status: {
            state: 'closed',
            label: 'Closed',
            detail: 'No confirmed hours',
            closesAt: null,
            opensAt: null,
            lastOrderAt: null
          }
        })
      ],
      'best'
    );

    expect(sorted[0].id).toBe('near-b');
  });

  it('sorts by price ascending', () => {
    const sorted = sortPlaces(
      [makePlace('far', { distanceMeters: 1400 }), makePlace('near', { distanceMeters: 200 })],
      'distanceAsc'
    );
    expect(sorted.map((place) => place.id)).toEqual(['near', 'far']);
  });

  it('sorts by distance descending', () => {
    const sorted = sortPlaces(
      [makePlace('far', { distanceMeters: 1400 }), makePlace('near', { distanceMeters: 200 })],
      'distanceDesc'
    );
    expect(sorted.map((place) => place.id)).toEqual(['far', 'near']);
  });

  it('sorts by tabelog rating before distance', () => {
    const sorted = sortPlaces(
      [
        makePlace('closer', { distanceMeters: 200, tabelog: { score: 3.7, reviews: 100 } }),
        makePlace('higher-rated', { distanceMeters: 800, tabelog: { score: 4.1, reviews: 40 } })
      ],
      'tabelog'
    );
    expect(sorted.map((place) => place.id)).toEqual(['higher-rated', 'closer']);
  });

  it('sorts by google rating before distance', () => {
    const sorted = sortPlaces(
      [
        makePlace('closer', { distanceMeters: 200, google: { score: 4.1, reviews: 100 } }),
        makePlace('higher-rated', { distanceMeters: 800, google: { score: 4.7, reviews: 40 } })
      ],
      'google'
    );
    expect(sorted.map((place) => place.id)).toEqual(['higher-rated', 'closer']);
  });
});
