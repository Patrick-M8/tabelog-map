import type { ActiveFilters } from '$lib/types';

export function countActiveFilters(filters: ActiveFilters) {
  let total = 0;

  if (filters.openNow) total += 1;
  if (filters.closingSoon) total += 1;
  if (filters.hidePermanentlyClosed) total += 1;
  if (filters.maxWalkMinutes !== null) total += 1;
  if (filters.priceBands.length > 0) total += 1;
  if (filters.categoryKeys.length > 0) total += 1;

  return total;
}

export function summarizeFilters(filters: ActiveFilters) {
  const parts: string[] = [];

  if (filters.openNow) {
    parts.push('Open now');
  }

  if (filters.closingSoon) {
    parts.push('Closing soon');
  }

  if (filters.hidePermanentlyClosed) {
    parts.push('Hide closed');
  }

  if (filters.maxWalkMinutes !== null) {
    parts.push(`\u2264${filters.maxWalkMinutes} min`);
  }

  if (filters.priceBands.length > 0) {
    parts.push(`${filters.priceBands.length} price level${filters.priceBands.length === 1 ? '' : 's'}`);
  }

  if (filters.categoryKeys.length > 0) {
    parts.push(`${filters.categoryKeys.length} cuisine${filters.categoryKeys.length === 1 ? '' : 's'}`);
  }

  return parts.length > 0 ? parts.slice(0, 3).join(', ') : 'All nearby';
}
