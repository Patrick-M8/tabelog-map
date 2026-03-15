<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { DisplayPlace } from '$lib/types';
  import { formatPlaceCardMeta, formatPlaceCardRatings, formatPlaceCardSubtitle } from '$lib/utils/placeCard';

  export let place: DisplayPlace;
  export let imageUrl: string | null = null;
  export let selected = false;
  export let layout: 'compact' | 'expanded' = 'compact';

  const dispatch = createEventDispatcher<{
    select: { id: string };
    directions: { id: string };
    reserve: { id: string };
  }>();

  const metaIcons = ['category', 'price', 'walk', 'distance'] as const;

  $: title = place.nameEn ?? place.nameJp ?? 'Untitled place';
  $: subtitle = formatPlaceCardSubtitle(place);
  $: metaItems = formatPlaceCardMeta(place).map((label, index) => ({
    label,
    icon: metaIcons[index]
  }));
  $: ratings = formatPlaceCardRatings(place);
</script>

<article class:selected class:expanded={layout === 'expanded'} class="card">
  <button
    type="button"
    class="card-main-button"
    aria-label={`View details for ${title}`}
    on:click={() => dispatch('select', { id: place.id })}
  >
    <div class="card-shell">
      <div class="preview">
        {#if imageUrl}
          <img src={imageUrl} alt={title} loading="lazy" />
        {:else}
          <div class="preview-placeholder">No photo yet</div>
        {/if}
      </div>

      <div class="card-copy">
        <div class="title-row">
          <div class="title-block">
            <h3>{title}</h3>
            {#if subtitle}
              <p class="subtitle">{subtitle}</p>
            {/if}
          </div>
          <span class={`status-pill ${place.status.state}`}>{place.status.label}</span>
        </div>

        <div class="meta-row" aria-label="Restaurant summary">
          {#each metaItems as item}
            <span class="meta-item">
              <span class={`meta-icon ${item.icon}`} aria-hidden="true">
                {#if item.icon === 'category'}
                  <svg viewBox="0 0 16 16">
                    <path d="M5 2.75v10.5M3.5 5.25h3M11 2.75v10.5M11 7.25c1.35 0 2.5-1.12 2.5-2.5v-2" />
                  </svg>
                {:else if item.icon === 'price'}
                  <svg viewBox="0 0 16 16">
                    <path d="M3 4.25h10v7.5H3zM5 8h6M5 6.25h1.25M9.75 9.75H11" />
                  </svg>
                {:else if item.icon === 'walk'}
                  <svg viewBox="0 0 16 16">
                    <path d="M8.2 3.1a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM5.8 13.2l.7-3.2-1.8-1.6.9-2.6h2.1l1.5 1.8 1.7.7-.4 1.1-2.2-.8-.7-.8-.4 2 1.2 3.4H7.2l-.9-2.6-.4 2.6Z" />
                  </svg>
                {:else}
                  <svg viewBox="0 0 16 16">
                    <path d="M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 0 1 0-11Zm0 2.1v3.35l2.4 1.45" />
                  </svg>
                {/if}
              </span>
              <span>{item.label}</span>
            </span>
          {/each}
        </div>

        <div class="ratings-line" aria-label="Ratings and reviews">
          <span class="ratings-source tabelog">{ratings.tabelog}</span>
          <span class="ratings-source google">{ratings.google}</span>
        </div>

        <div class="status-line">
          <span>{place.status.detail}</span>
        </div>
      </div>
    </div>
  </button>

  <div class="cta-row">
    <button
      type="button"
      class="primary"
      aria-label={`Get directions to ${title}`}
      on:click|stopPropagation={() => dispatch('directions', { id: place.id })}
    >
      Directions
    </button>
    {#if place.reserveUrl}
      <button
        type="button"
        class="secondary"
        aria-label={`Open reservation options for ${title}`}
        on:click|stopPropagation={() => dispatch('reserve', { id: place.id })}
      >
        Reserve
      </button>
    {/if}
  </div>
</article>

<style>
  .card {
    display: grid;
    gap: 12px;
    padding: 15px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(17, 17, 17, 0.05);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    transition:
      transform 220ms ease,
      box-shadow 220ms ease,
      border-color 220ms ease,
      background-color 220ms ease;
    will-change: transform;
  }

  .card.selected {
    border-color: rgba(0, 122, 255, 0.18);
    box-shadow:
      0 10px 26px rgba(15, 23, 42, 0.1),
      0 0 0 1px rgba(0, 122, 255, 0.06);
  }

  .card.expanded {
    gap: 16px;
    padding: 18px;
    animation: card-rise 260ms ease both;
  }

  .card-main-button {
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    color: inherit;
  }

  .card-shell {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    gap: 12px;
    align-items: stretch;
  }

  .card.expanded .card-shell {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }

  .card-copy {
    min-width: 0;
    display: grid;
    gap: 8px;
    align-content: start;
  }

  .preview {
    position: relative;
    overflow: hidden;
    border-radius: 13px;
    background: linear-gradient(145deg, rgba(216, 221, 228, 0.8), rgba(244, 245, 248, 0.96));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.64),
      inset 0 -1px 0 rgba(17, 24, 39, 0.06);
    transform: translateZ(0);
    transition: border-radius 220ms ease;
  }

  .preview::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(15, 23, 42, 0.14));
    pointer-events: none;
  }

  .preview img,
  .preview-placeholder {
    width: 100%;
    height: 100%;
    min-height: 110px;
    object-fit: cover;
    display: grid;
    place-items: center;
    color: #6e6e73;
    font-size: 0.8rem;
    transition: min-height 220ms ease, transform 220ms ease;
  }

  .card.expanded .preview img,
  .card.expanded .preview-placeholder {
    min-height: 188px;
  }

  .title-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }

  .title-block {
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  h3,
  p {
    margin: 0;
  }

  h3 {
    font-size: 1.08rem;
    line-height: 1.2;
    font-weight: 600;
    letter-spacing: -0.015em;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .subtitle {
    font-size: 0.84rem;
    line-height: 1.28;
    color: #6e6e73;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .meta-row,
  .ratings-line,
  .status-line,
  .cta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    align-items: center;
  }

  .meta-row,
  .ratings-line,
  .status-line {
    color: #8e8e93;
    font-size: 0.79rem;
    line-height: 1.3;
  }

  .meta-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .meta-icon {
    display: inline-flex;
    width: 14px;
    height: 14px;
    color: #a1a1a7;
    flex: 0 0 auto;
  }

  .meta-icon svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .ratings-line {
    gap: 4px 8px;
  }

  .ratings-source {
    font-weight: 600;
    color: #4d4d52;
  }

  .ratings-source.tabelog {
    color: #7d6148;
  }

  .ratings-source.google {
    color: #55606f;
  }

  .status-line {
    color: #8e8e93;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 5px 10px;
    font-size: 0.72rem;
    line-height: 1;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
    flex: 0 0 auto;
  }

  .status-pill.open {
    background: #e8f5e9;
    color: #2a6f46;
  }

  .status-pill.closingSoon {
    background: #fff4e5;
    color: #9b6a22;
  }

  .status-pill.closed {
    background: rgba(142, 142, 147, 0.14);
    color: #6b6b73;
  }

  .cta-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .cta-row button {
    min-height: 40px;
    border: 0;
    border-radius: 13px;
    padding: 10px 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    transition:
      transform 180ms ease,
      box-shadow 180ms ease,
      background-color 180ms ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .cta-row button:only-child {
    grid-column: 1 / -1;
  }

  .cta-row button:active {
    transform: translateY(1px) scale(0.995);
  }

  .cta-row button.primary {
    background: #17191c;
    color: #fff;
  }

  .cta-row button.secondary {
    background: rgba(23, 25, 28, 0.08);
    color: #17191c;
  }

  .card.expanded .preview {
    border-radius: 14px;
  }

  @media (max-width: 520px) {
    .card {
      gap: 10px;
      padding: 13px;
    }

    .card-shell {
      grid-template-columns: 88px minmax(0, 1fr);
      gap: 10px;
    }

    .card.expanded {
      padding: 16px;
    }

    .card.expanded .preview img,
    .card.expanded .preview-placeholder {
      min-height: 176px;
    }

    .preview img,
    .preview-placeholder {
      min-height: 98px;
    }

    h3 {
      font-size: 1rem;
    }

    .subtitle,
    .meta-row,
    .ratings-line,
    .status-line {
      font-size: 0.77rem;
    }

    .cta-row {
      gap: 7px;
    }

    .cta-row button {
      min-height: 38px;
      padding: 9px 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card,
    .preview,
    .preview img,
    .preview-placeholder,
    .cta-row button {
      transition: none;
    }
  }

  @keyframes card-rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
