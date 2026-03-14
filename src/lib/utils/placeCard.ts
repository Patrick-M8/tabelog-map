import type { DisplayPlace } from '$lib/types';

import { formatDistance, formatPriceBand } from '$lib/utils/format';

const MIDDLE_DOT = '\u00B7';
const STAR = '\u2605';

function compactReviewCount(count: number) {
  if (count >= 1000) {
    const short = (count / 1000).toFixed(count >= 10000 ? 0 : 1);
    return `${short.replace(/\.0$/, '')}K`;
  }

  return count.toLocaleString();
}

export function formatPlaceCardSubtitle(place: Pick<DisplayPlace, 'nameEn' | 'nameJp' | 'subCategories' | 'station' | 'area'>) {
  const primaryName = place.nameEn ?? place.nameJp ?? '';
  if (place.nameJp && place.nameJp !== primaryName) {
    return place.nameJp;
  }

  if (place.subCategories.length > 1) {
    return place.subCategories.slice(0, 2).join(` ${MIDDLE_DOT} `);
  }

  return place.station ?? place.area ?? null;
}

export function formatPlaceCardMeta(
  place: Pick<DisplayPlace, 'category' | 'priceBand' | 'priceBucket' | 'walkMinutes' | 'distanceMeters'>
) {
  return [
    place.category.label,
    formatPriceBand(place.priceBand, place.priceBucket),
    `${place.walkMinutes} min walk`,
    formatDistance(place.distanceMeters)
  ];
}

export function formatPlaceCardRatings(place: Pick<DisplayPlace, 'tabelog' | 'google'>) {
  return {
    tabelog: `Tabelog ${place.tabelog.score ?? '-'} (${compactReviewCount(place.tabelog.reviews)})`,
    google: `Google ${place.google.score ?? '-'} ${STAR} (${compactReviewCount(place.google.reviews)})`
  };
}
