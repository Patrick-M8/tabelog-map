<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { ActiveFilters, PriceMeal } from '$lib/types';
  import { formatPriceTierLabel } from '$lib/utils/priceTier';

  export let activeFilters: ActiveFilters;
  export let walkMinuteOptions: number[] = [];
  export let priceTiers: number[] = [];
  export let visibleCuisineCategories: { key: string; label: string; count: number }[] = [];
  export let availableCategories: { key: string; label: string; count: number }[] = [];
  export let cuisineExpanded = false;
  export let categorySectionElement: HTMLElement | null = null;
  export let walkSectionElement: HTMLElement | null = null;
  export let priceSectionElement: HTMLElement | null = null;

  const dispatch = createEventDispatcher<{
    resetAvailability: void;
    toggleClosingSoon: void;
    toggleOpeningSoon: void;
    setWalkMinutes: { minutes: number };
    setPriceMeal: { meal: PriceMeal };
    togglePriceTier: { tier: number };
    toggleCategory: { key: string };
    toggleCuisineExpanded: void;
  }>();
  const PRICE_MEAL_OPTIONS: { label: string; value: PriceMeal }[] = [
    { label: 'Dinner', value: 'dinner' },
    { label: 'Lunch', value: 'lunch' }
  ];

  $: showAvailabilityReset = activeFilters.closingSoon || activeFilters.openingSoon;
</script>

<div class="filters-panel-content">
  <section class="filter-section">
    <div class="section-heading">
      <h3>Availability</h3>
      {#if showAvailabilityReset}
        <button type="button" class="text-button" on:click={() => dispatch('resetAvailability')}>
          Reset
        </button>
      {/if}
    </div>
    <div class="token-wrap">
      <button type="button" class:active={activeFilters.openingSoon} on:click={() => dispatch('toggleOpeningSoon')}>
        Opening soon
      </button>
      <button type="button" class:active={activeFilters.closingSoon} on:click={() => dispatch('toggleClosingSoon')}>
        Closing soon
      </button>
    </div>
  </section>

  <section bind:this={walkSectionElement} class="filter-section">
    <div class="section-heading">
      <h3>Walk time</h3>
    </div>
    <div class="token-wrap">
      {#each walkMinuteOptions as minutes}
        <button
          type="button"
          class:active={activeFilters.maxWalkMinutes === minutes}
          on:click={() => dispatch('setWalkMinutes', { minutes })}
        >
          ≤ {minutes} min
        </button>
      {/each}
    </div>
  </section>

  <section bind:this={priceSectionElement} class="filter-section">
    <div class="section-heading">
      <h3>Price</h3>
    </div>
    <div class="token-wrap price-meal-toggle" role="group" aria-label="Price meal">
      {#each PRICE_MEAL_OPTIONS as meal}
        <button
          type="button"
          class:active={activeFilters.priceMeal === meal.value}
          aria-pressed={activeFilters.priceMeal === meal.value}
          on:click={() => dispatch('setPriceMeal', { meal: meal.value })}
        >
          {meal.label}
        </button>
      {/each}
    </div>
    <div class="token-wrap">
      {#each priceTiers as tier}
        <button
          type="button"
          class:active={activeFilters.priceTiers.includes(tier)}
          on:click={() => dispatch('togglePriceTier', { tier })}
        >
          {formatPriceTierLabel(tier)}
        </button>
      {/each}
    </div>
  </section>

  <section bind:this={categorySectionElement} class="filter-section">
    <div class="section-heading">
      <h3>Cuisine</h3>
    </div>
    <div class="token-wrap token-wrap-categories">
      {#each visibleCuisineCategories as category}
        <button
          type="button"
          class:active={activeFilters.categoryKeys.includes(category.key)}
          on:click={() => dispatch('toggleCategory', { key: category.key })}
        >
          {category.label}
        </button>
      {/each}
    </div>
    {#if cuisineExpanded || availableCategories.length > visibleCuisineCategories.length}
      <button type="button" class="text-button" on:click={() => dispatch('toggleCuisineExpanded')}>
        {cuisineExpanded ? 'Show less' : `Show ${availableCategories.length - visibleCuisineCategories.length} more`}
      </button>
    {/if}
  </section>
</div>

<style>
  .filters-panel-content,
  .filter-section {
    display: grid;
    gap: 10px;
  }

  .section-heading {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: center;
  }

  .section-heading h3 {
    margin: 0;
  }

  .text-button {
    border: 0;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    padding: 0;
  }

  .token-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .token-wrap button {
    min-height: 40px;
    padding: 10px 13px;
    white-space: nowrap;
    border: 1px solid rgba(23, 25, 28, 0.08);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.88);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
    transition:
      background-color 180ms ease,
      color 180ms ease,
      border-color 180ms ease,
      transform 180ms ease;
  }

  .token-wrap button.active {
    background: #17191c;
    color: #f8f7f4;
    border-color: transparent;
  }

  .price-meal-toggle button {
    min-width: 92px;
    justify-content: center;
  }

  .token-wrap-categories button {
    max-width: 100%;
  }
</style>
