const PRICE_BUCKET_RANGES: Record<number, string> = {
  1: 'Up to \u00A5999',
  2: '\u00A51,000-\u00A51,999',
  3: '\u00A52,000-\u00A53,999',
  4: '\u00A54,000-\u00A57,999',
  5: '\u00A58,000+'
};

export function normalizePriceBand(priceBand: string | null, fallbackBucket = 0) {
  const normalizedCount = (priceBand?.match(/\u00A5/g) ?? []).length || fallbackBucket;
  return normalizedCount > 0 ? '\u00A5'.repeat(normalizedCount) : null;
}

export function priceBucketFromBand(priceBand: string | null, fallbackBucket = 0) {
  return normalizePriceBand(priceBand, fallbackBucket)?.length ?? 0;
}

export function formatPriceRange(priceBand: string | null, fallbackBucket = 0) {
  return PRICE_BUCKET_RANGES[priceBucketFromBand(priceBand, fallbackBucket)] ?? 'Price TBD';
}

export function formatRelativeUpdate(isoString: string) {
  const updatedAt = new Date(isoString).getTime();
  if (Number.isNaN(updatedAt)) {
    return 'Updated recently';
  }

  const diffHours = Math.max(1, Math.round((Date.now() - updatedAt) / 36e5));
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

export function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

export function formatPriceBand(priceBand: string | null, fallbackBucket = 0) {
  const normalizedBand = normalizePriceBand(priceBand, fallbackBucket);
  if (!normalizedBand) {
    return 'Price TBD';
  }

  return `${normalizedBand} / ${formatPriceRange(normalizedBand, fallbackBucket)}`;
}

export function formatHourLabel(hour: string | null) {
  return hour ?? '--:--';
}
