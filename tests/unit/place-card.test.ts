import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import type { DisplayPlace } from '../../src/lib/types';
import PlaceCard from '../../src/lib/components/PlaceCard.svelte';
import { formatPlaceCardMeta, formatPlaceCardRatings, formatPlaceCardSubtitle } from '../../src/lib/utils/placeCard';

const MIDDLE_DOT = '\u00B7';
const STAR = '\u2605';

const basePlace: DisplayPlace = {
  id: 'le-petit-mec',
  placeId: 'abc123',
  nameEn: 'Le Petit Mec Hibiya',
  nameJp: 'ル・プチメック 日比谷店',
  lat: 35.0,
  lng: 139.0,
  region: 'TOKYO',
  station: 'Hibiya Station',
  area: 'Tokyo',
  category: {
    key: 'bakery',
    label: 'Bakery',
    labelJp: 'パン'
  },
  subCategories: ['Bakery'],
  priceBand: '¥',
  priceBucket: 1,
  weeklyTimeline: {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: []
  },
  hoursConfidence: 'high',
  hoursDisplay: {
    today: 'Closed',
    week: 'Mon-Sun closed'
  },
  hoursSpecialDays: {
    publicHoliday: [],
    dayBeforePublicHoliday: [],
    dayAfterPublicHoliday: []
  },
  hoursPolicies: [],
  freshnessUpdatedAt: '2026-03-15T01:04:17+09:00',
  consensusScore: 2.1,
  consensusGrade: 'A',
  tabelog: {
    score: 3.72,
    reviews: 206
  },
  google: {
    score: 4.1,
    reviews: 1204
  },
  sourceLinks: {
    tabelog: 'https://example.com/tabelog',
    google: 'https://example.com/google'
  },
  reserveUrl: 'https://example.com/reserve',
  callPhone: null,
  advisories: [],
  badges: [],
  closure: {
    state: 'active',
    source: 'derived',
    reason: null,
    detectedAt: null
  },
  distanceMeters: 9500,
  walkMinutes: 119,
  status: {
    state: 'open',
    label: 'Open',
    detail: `Closes 20:00 ${MIDDLE_DOT} L.O. 19:30`,
    closesAt: '20:00',
    opensAt: null,
    lastOrderAt: '19:30'
  }
};

describe('place card formatting', () => {
  it('builds a compact subtitle from the Japanese name when available', () => {
    expect(formatPlaceCardSubtitle(basePlace)).toBe('ル・プチメック 日比谷店');
  });

  it('builds premium metadata copy for the compact line', () => {
    expect(formatPlaceCardMeta(basePlace)).toEqual(['Bakery', '¥ / Up to ¥999', '119 min walk', '9.5 km']);
  });

  it('formats Tabelog and Google reputation into a single readable line', () => {
    expect(formatPlaceCardRatings(basePlace)).toEqual({
      tabelog: 'Tabelog 3.72 (206)',
      google: `Google 4.1 ${STAR} (1.2K)`
    });
  });

  it('falls back to a secondary descriptor when there is no alternate-language name', () => {
    const place = {
      ...basePlace,
      nameEn: 'Sushi Dai',
      nameJp: 'Sushi Dai',
      subCategories: ['Sushi', 'Omakase']
    };

    expect(formatPlaceCardSubtitle(place)).toBe(`Sushi ${MIDDLE_DOT} Omakase`);
  });

  it('renders an Opening soon status pill on the card', () => {
    const result = render(PlaceCard, {
      props: {
        place: {
          ...basePlace,
          status: {
            state: 'openingSoon',
            label: 'Opening soon',
            detail: 'Opens 09:00',
            closesAt: null,
            opensAt: '09:00',
            lastOrderAt: null
          }
        },
        imageUrl: null,
        selected: false
      }
    });

    expect(result.body).toContain('Opening soon');
    expect(result.body).toContain('status-pill openingSoon');
  });
});
