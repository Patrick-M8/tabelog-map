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

export function formatPriceBand(priceBand: string | null) {
  return priceBand ?? 'Price TBD';
}

export function formatHourLabel(hour: string | null) {
  return hour ?? '--:--';
}
