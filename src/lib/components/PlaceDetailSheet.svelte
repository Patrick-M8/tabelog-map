<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import { formatRelativeUpdate } from '$lib/utils/format';
  import type { PlaceDetail, PlaceStatus } from '$lib/types';

  export let detail: PlaceDetail | null = null;
  export let status: PlaceStatus | null = null;

  const dispatch = createEventDispatcher<{
    close: void;
    directions: { id: string };
    reserve: { id: string };
  }>();

  const dayLabels = [
    ['mon', 'Mon'],
    ['tue', 'Tue'],
    ['wed', 'Wed'],
    ['thu', 'Thu'],
    ['fri', 'Fri'],
    ['sat', 'Sat'],
    ['sun', 'Sun']
  ] as const;
</script>

{#if detail && status}
  <aside class="detail">
    <div class="detail-header">
      <div>
        <p class="eyebrow">{detail.category.label}</p>
        <h2>{detail.nameEn ?? detail.nameJp}</h2>
        <p class="secondary">{detail.station ?? detail.area ?? detail.address ?? 'Japan'}</p>
      </div>
      <button type="button" class="ghost ghost-icon" aria-label="Close details" on:click={() => dispatch('close')}>
        <span aria-hidden="true">×</span>
      </button>
    </div>

    <div class="hero">
      {#if detail.imageUrl}
        <img src={detail.imageUrl} alt={detail.nameEn ?? detail.nameJp ?? 'Restaurant'} loading="lazy" />
      {:else}
        <div class="placeholder">No image yet</div>
      {/if}
    </div>

    <section class="hero-meta panel">
      <div class="panel-head">
        <span class={`status-pill ${status.state}`}>{status.label}</span>
        <span>{status.detail}</span>
      </div>
      <p class="quiet">{formatRelativeUpdate(detail.freshnessUpdatedAt)} · Hours confidence {detail.hoursConfidence}</p>
      <div class="button-row">
        <button type="button" on:click={() => dispatch('directions', { id: detail.id })}>Directions</button>
        <button type="button" class:muted={!detail.reserveUrl} disabled={!detail.reserveUrl} on:click={() => dispatch('reserve', { id: detail.id })}>
          Reserve
        </button>
      </div>
    </section>

    <div class="detail-grid">
      <section class="panel">
        <h3>Ratings</h3>
        <div class="rating-grid">
          <div class="rating-card tabelog">
            <span>Tabelog</span>
            <strong>{detail.tabelog.score ?? '-'}</strong>
            <small>{detail.tabelog.reviews.toLocaleString()} reviews</small>
          </div>
          <div class="rating-card google">
            <span>Google</span>
            <strong>{detail.google.score ?? '-'}</strong>
            <small>{detail.google.reviews.toLocaleString()} reviews</small>
          </div>
        </div>
      </section>

      <section class="panel">
        <h3>Location</h3>
        <p>{detail.address ?? detail.area ?? 'Address unavailable'}</p>
        {#if detail.mustOrder}
          <p class="quiet">Signature: {detail.mustOrder}</p>
        {/if}
      </section>

      <section class="panel">
        <h3>Hours</h3>
        <div class="timeline">
          {#each dayLabels as [key, label]}
            <div class="timeline-row">
              <span>{label}</span>
              <strong>
                {#if detail.weeklyTimeline[key].length}
                  {detail.weeklyTimeline[key].map((window) => `${window.open} - ${window.close}`).join(' · ')}
                {:else}
                  Closed
                {/if}
              </strong>
            </div>
          {/each}
        </div>
      </section>
    </div>
  </aside>
{/if}

<style>
  .detail {
    display: grid;
    gap: 16px;
    padding-bottom: 8px;
  }

  .detail-header,
  .panel-head,
  .button-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }

  .detail-grid,
  .rating-grid,
  .timeline {
    display: grid;
    gap: 14px;
  }

  .eyebrow,
  .secondary,
  .quiet,
  .timeline-row span,
  .timeline-row strong,
  .rating-card span,
  .rating-card small {
    color: rgba(23, 25, 28, 0.68);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  .hero img,
  .placeholder {
    width: 100%;
    aspect-ratio: 1.75;
    border-radius: 24px;
    object-fit: cover;
    background: linear-gradient(140deg, rgba(23, 25, 28, 0.08), rgba(200, 100, 59, 0.14));
    display: grid;
    place-items: center;
  }

  .panel {
    background: rgba(255, 255, 255, 0.88);
    border-radius: 24px;
    padding: 16px;
    display: grid;
    gap: 12px;
    border: 1px solid rgba(23, 25, 28, 0.08);
  }

  .timeline-row {
    display: grid;
    grid-template-columns: 48px 1fr;
    gap: 10px;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 6px 10px;
    font-weight: 600;
  }

  .status-pill.open {
    background: rgba(47, 125, 87, 0.12);
    color: #20583d;
  }

  .status-pill.closingSoon {
    background: rgba(200, 100, 59, 0.14);
    color: #8b4b30;
  }

  .status-pill.closed {
    background: rgba(107, 114, 128, 0.14);
    color: #5a6270;
  }

  .rating-card {
    border-radius: 18px;
    padding: 14px;
    display: grid;
    gap: 4px;
  }

  .rating-card strong {
    font-size: 1.4rem;
  }

  .rating-card.tabelog {
    background: rgba(200, 100, 59, 0.12);
  }

  .rating-card.google {
    background: rgba(47, 125, 87, 0.1);
  }

  .button-row button,
  .ghost {
    border-radius: 16px;
    border: 0;
    padding: 12px 14px;
    font: inherit;
  }

  .button-row button {
    flex: 1 1 0;
    background: #17191c;
    color: #f8f7f4;
    font-weight: 600;
  }

  .button-row button.muted {
    background: rgba(23, 25, 28, 0.08);
    color: rgba(23, 25, 28, 0.44);
  }

  .ghost {
    background: rgba(23, 25, 28, 0.08);
    color: #17191c;
  }

  .ghost-icon {
    width: 42px;
    height: 42px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.3rem;
    line-height: 1;
  }
</style>
