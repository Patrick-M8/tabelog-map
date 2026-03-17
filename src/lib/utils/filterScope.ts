import type { ActiveFilters } from '$lib/types';

export function toAdvancedFilters(filters: ActiveFilters): ActiveFilters {
  return {
    ...filters,
    openNow: false
  };
}
