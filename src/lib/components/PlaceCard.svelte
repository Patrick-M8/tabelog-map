<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import { formatDistance, formatPriceBand, formatRelativeUpdate } from '$lib/utils/format';
  import type { DisplayPlace } from '$lib/types';

  export let place: DisplayPlace;
  export let selected = false;
  export let saved = false;

  const dispatch = createEventDispatcher<{
    select: { id: string };
    directions: { id: string };
    reserve: { id: string };
    call: { id: string };
    save: { id: string };
  }>();
</script>

<article class:selected class="card">
  <button type="button" class="card-main-button" on:click={() => dispatch('select', { id: place.id })}>
    <div class="card-main">
      <div class="title-row">
        <div>
          <h3>{place.nameEn ?? place.nameJp ?? 'Untitled place'}</h3>
          <p>{place.nameJp ?? place.nameEn ?? ''}</p>
        </div>
      </div>

      <div class="facts">
        <span class="grade">{place.consensusGrade}</span>
        <span>{place.walkMinutes} min walk</span>
        <span>{formatPriceBand(place.priceBand)}</span>
        <span>{place.category.label}</span>
      </div>

      <div class="status-row">
        <span class={`status-pill ${place.status.state}`}>{place.status.label}</span>
        <span>{place.status.detail}</span>
        <span>{formatRelativeUpdate(place.freshnessUpdatedAt)}</span>
      </div>

      <div class="source-row">
        <span>Tabelog {place.tabelog.score ?? '-'} ({place.tabelog.reviews})</span>
        <span>Google {place.google.score ?? '-'} ({place.google.reviews})</span>
        <span>{formatDistance(place.distanceMeters)}</span>
      </div>
    </div>
  </button>

  <div class="cta-row">
    <button
      type="button"
      class="save-button"
      aria-label={saved ? 'Remove from saved places' : 'Save place'}
      on:click|stopPropagation={() => dispatch('save', { id: place.id })}
    >
      {saved ? 'Saved' : 'Save'}
    </button>
    <button type="button" on:click|stopPropagation={() => dispatch('directions', { id: place.id })}>Directions</button>
    <button
      type="button"
      class:muted={!place.reserveUrl}
      disabled={!place.reserveUrl}
      on:click|stopPropagation={() => dispatch('reserve', { id: place.id })}
    >
      Reserve
    </button>
    <button
      type="button"
      class:muted={!place.callPhone}
      disabled={!place.callPhone}
      on:click|stopPropagation={() => dispatch('call', { id: place.id })}
    >
      Call
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
    cursor: pointer;
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

  .title-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
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

  .save-button {
    background: rgba(31, 42, 47, 0.08) !important;
    color: #1f2a2f !important;
  }

  .facts,
  .status-row,
  .source-row,
  .cta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    align-items: center;
  }

  .facts span,
  .status-row span,
  .source-row span {
    color: rgba(31, 42, 47, 0.72);
    font-size: 0.85rem;
  }

  .grade {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: #1f2a2f;
    color: #f6f1e8 !important;
    font-weight: 700;
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
    flex: 1 1 96px;
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
