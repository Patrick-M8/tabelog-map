import type { PriceMeal } from '$lib/types';

const PRICE_TIER_LABELS: Record<number, string> = {
  1: 'Up to \u00A5999',
  2: '\u00A51,000-\u00A51,999',
  3: '\u00A52,000-\u00A53,999',
  4: '\u00A54,000-\u00A59,999',
  5: '\u00A510,000+'
};

export const PRICE_TIER_OPTIONS = [1, 2, 3, 4, 5];

type MealPriceTiers = {
  priceTierDinner: number;
  priceTierLunch: number;
};

export function formatPriceTierLabel(tier: number) {
  return PRICE_TIER_LABELS[tier] ?? 'Price TBD';
}

export function getPriceTierForMeal(place: MealPriceTiers, meal: PriceMeal) {
  return meal === 'lunch' ? place.priceTierLunch : place.priceTierDinner;
}

export function matchesPriceFilter(place: MealPriceTiers, meal: PriceMeal, selectedTiers: number[]) {
  if (!selectedTiers.length) {
    return true;
  }

  const tier = getPriceTierForMeal(place, meal);
  return tier > 0 && selectedTiers.includes(tier);
}
