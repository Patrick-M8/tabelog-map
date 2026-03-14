import { describe, expect, it } from 'vitest';

import { formatPriceBand, formatPriceRange, normalizePriceBand, priceBucketFromBand } from '../../src/lib/utils/format';

describe('price formatting', () => {
  it('maps yen bands to numeric ranges', () => {
    expect(formatPriceRange('¥')).toBe('Up to ¥999');
    expect(formatPriceRange('¥¥')).toBe('¥1,000-¥1,999');
    expect(formatPriceRange('¥¥¥')).toBe('¥2,000-¥3,999');
    expect(formatPriceRange('¥¥¥¥')).toBe('¥4,000-¥7,999');
    expect(formatPriceRange('¥¥¥¥¥')).toBe('¥8,000+');
  });

  it('formats combined band and range labels', () => {
    expect(formatPriceBand('¥¥¥')).toBe('¥¥¥ / ¥2,000-¥3,999');
    expect(formatPriceBand(null)).toBe('Price TBD');
  });

  it('derives a bucket from the band width', () => {
    expect(priceBucketFromBand('¥¥¥¥')).toBe(4);
    expect(priceBucketFromBand(null)).toBe(0);
  });

  it('normalizes mojibake price-band strings from the dataset', () => {
    expect(normalizePriceBand('Â¥Â¥Â¥')).toBe('¥¥¥');
    expect(formatPriceBand('Â¥Â¥', 2)).toBe('¥¥ / ¥1,000-¥1,999');
  });
});
