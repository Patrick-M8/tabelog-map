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
          <p>{place.nameJp ?? place.nameEn ?? ''}</p>
        </div>
        <span class="updated">{formatRelativeUpdate(place.freshnessUpdatedAt)}</span>
      </div>

      <div class="rating-row">
        <span class="rating-pill tabelog">Tabelog {place.tabelog.score ?? '-'} · {place.tabelog.reviews}</span>
        <span class="rating-pill google">Google {place.google.score ?? '-'} · {place.google.reviews}</span>
      </div>

      <div class="facts">
        <span>{place.walkMinutes} min walk</span>
        <span>{formatPriceBand(place.priceBand, place.priceBucket)}</span>
        <span>{place.category.label}</span>
      </div>

      <div class="status-row">
        <span class={`status-pill ${place.status.state}`}>{place.status.label}</span>
        <span>{place.status.detail}</span>
        <span>{formatDistance(place.distanceMeters)}</span>
      </div>
    </div>
  </button>

  <div class="cta-row">
    <button type="button" on:click|stopPropagation={() => dispatch('directions', { id: place.id })}>Directions</button>
    <button
      type="button"
      class:muted={!place.reserveUrl}
      disabled={!place.reserveUrl}
      on:click|stopPropagation={() => dispatch('reserve', { id: place.id })}
    >
      Reserve
    </button>
  </div>
</article>

<style>
  .card {
    display: grid;
    gap: 12px;
    padding: 14px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(31, 42, 47, 0.08);
    box-shadow: 0 10px 24px rgba(31, 42, 47, 0.06);
  }

  .card.selected {
    border-color: rgba(201, 112, 51, 0.45);
    box-shadow: 0 16px 36px rgba(201, 112, 51, 0.16);
  }

  .card-main-button {
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .card-main {
    display: grid;
    gap: 10px;
  }

  .preview {
    width: 100%;
    border-radius: 18px;
    overflow: hidden;
    background: linear-gradient(135deg, rgba(31, 42, 47, 0.08), rgba(201, 112, 51, 0.16));
  }

  .preview img,
  .preview-placeholder {
    width: 100%;
    aspect-ratio: 1.8;
    object-fit: cover;
    display: grid;
    place-items: center;
    color: rgba(31, 42, 47, 0.62);
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
    font-size: 1rem;
    line-height: 1.15;
  }

  p {
    margin: 4px 0 0;
    color: rgba(31, 42, 47, 0.66);
    font-size: 0.83rem;
  }

  .updated {
    color: rgba(31, 42, 47, 0.54);
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .rating-row,
  .facts,
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
    color: rgba(31, 42, 47, 0.72);
    font-size: 0.85rem;
  }

  .rating-pill {
    border-radius: 999px;
    padding: 6px 10px;
    font-weight: 600;
  }

  .rating-pill.tabelog {
    background: rgba(201, 112, 51, 0.14);
    color: #8d4d21;
  }

  .rating-pill.google {
    background: rgba(61, 140, 89, 0.14);
    color: #215337;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 6px 10px;
    font-weight: 600;
  }

  .status-pill.open {
    background: rgba(61, 140, 89, 0.14);
    color: #215337 !important;
  }

  .status-pill.closingSoon {
    background: rgba(201, 112, 51, 0.14);
    color: #8d4d21 !important;
  }

  .status-pill.closed {
    background: rgba(123, 123, 116, 0.14);
    color: #62625e !important;
  }

  .cta-row button {
    flex: 1 1 120px;
    min-width: 0;
    border: 0;
    border-radius: 14px;
    padding: 11px 12px;
    background: #1f2a2f;
    color: #f6f1e8;
    font-weight: 600;
  }

  .cta-row button.muted {
    background: rgba(31, 42, 47, 0.1);
    color: rgba(31, 42, 47, 0.44);
  }
</style>
