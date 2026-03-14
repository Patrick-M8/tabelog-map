<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import { formatDistance, formatPriceBand, formatRelativeUpdate } from '$lib/utils/format';
  import type { DisplayPlace } from '$lib/types';

  export let place: DisplayPlace;
  export let imageUrl: string | null = null;
  export let selected = false;

  const dispatch = createEventDispatcher<{
    select: { id: string };
    directions: { id: string };
    reserve: { id: string };
  }>();
</script>

<article class:selected class="card">
  <button type="button" class="card-main-button" on:click={() => dispatch('select', { id: place.id })}>
    <div class="card-main">
      <div class="preview">
        {#if imageUrl}
          <img src={imageUrl} alt={place.nameEn ?? place.nameJp ?? 'Restaurant'} loading="lazy" />
        {:else}
          <div class="preview-placeholder">No photo yet</div>
        {/if}
      </div>

      <div class="title-row">
        <div>
          <h3>{place.nameEn ?? place.nameJp ?? 'Untitled place'}</h3>
          <p>{place.category.label} · {place.station ?? place.area ?? 'Japan'}</p>
        </div>
        <span class={`status-pill ${place.status.state}`}>{place.status.label}</span>
      </div>

      <div class="facts">
        <span>{place.walkMinutes} min walk</span>
        <span>{formatPriceBand(place.priceBand, place.priceBucket)}</span>
        <span>{formatDistance(place.distanceMeters)}</span>
      </div>

      <div class="signal-row">
        <span class="rating-pill tabelog">Tabelog {place.tabelog.score ?? '-'} · {place.tabelog.reviews.toLocaleString()} reviews</span>
        <span class="updated">{formatRelativeUpdate(place.freshnessUpdatedAt)}</span>
      </div>

      <div class="status-row">
        <span>{place.status.detail}</span>
      </div>
    </div>
  </button>

  <div class="cta-row">
    <button type="button" on:click|stopPropagation={() => dispatch('directions', { id: place.id })}>Directions</button>
    {#if place.reserveUrl}
      <button type="button" class="secondary" on:click|stopPropagation={() => dispatch('reserve', { id: place.id })}>Reserve</button>
    {/if}
  </div>
</article>

<style>
  .card {
    display: grid;
    gap: 12px;
    padding: 14px;
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(23, 25, 28, 0.08);
    box-shadow: 0 14px 28px rgba(17, 24, 39, 0.06);
  }

  .card.selected {
    border-color: rgba(200, 100, 59, 0.42);
    box-shadow: 0 18px 40px rgba(200, 100, 59, 0.16);
  }

  .card-main-button {
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .card-main {
    display: grid;
    gap: 9px;
  }

  .preview {
    width: 100%;
    border-radius: 18px;
    overflow: hidden;
    background: linear-gradient(140deg, rgba(23, 25, 28, 0.08), rgba(200, 100, 59, 0.16));
  }

  .preview img,
  .preview-placeholder {
    width: 100%;
    aspect-ratio: 2.2;
    object-fit: cover;
    display: grid;
    place-items: center;
    color: rgba(23, 25, 28, 0.56);
    font-size: 0.84rem;
  }

  .title-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }

  h3 {
    margin: 0;
    font-size: 1.02rem;
    line-height: 1.2;
  }

  p {
    margin: 4px 0 0;
    color: rgba(23, 25, 28, 0.62);
    font-size: 0.84rem;
  }

  .updated {
    color: rgba(23, 25, 28, 0.52);
    font-size: 0.76rem;
  }

  .facts,
  .signal-row,
  .status-row,
  .cta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    align-items: center;
  }

  .rating-pill,
  .facts span,
  .status-row span {
    color: rgba(23, 25, 28, 0.72);
    font-size: 0.85rem;
  }

  .rating-pill {
    border-radius: 999px;
    padding: 7px 11px;
    font-weight: 600;
  }

  .rating-pill.tabelog {
    background: rgba(200, 100, 59, 0.12);
    color: #8b4b30;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 6px 10px;
    font-weight: 600;
    white-space: nowrap;
  }

  .status-pill.open {
    background: rgba(47, 125, 87, 0.12);
    color: #20583d !important;
  }

  .status-pill.closingSoon {
    background: rgba(200, 100, 59, 0.14);
    color: #8b4b30 !important;
  }

  .status-pill.closed {
    background: rgba(107, 114, 128, 0.14);
    color: #5a6270 !important;
  }

  .cta-row button {
    flex: 1 1 140px;
    min-width: 0;
    border: 0;
    border-radius: 16px;
    padding: 12px 14px;
    background: #17191c;
    color: #f8f7f4;
    font-weight: 600;
  }

  .cta-row button.secondary {
    background: rgba(23, 25, 28, 0.08);
    color: #17191c;
  }
</style>
