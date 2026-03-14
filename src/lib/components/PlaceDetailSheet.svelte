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
        <p class="secondary">{detail.nameJp ?? detail.nameEn}</p>
      </div>
      <button type="button" class="ghost" on:click={() => dispatch('close')}>Close</button>
    </div>

    <div class="hero">
      {#if detail.imageUrl}
        <img src={detail.imageUrl} alt={detail.nameEn ?? detail.nameJp ?? 'Restaurant'} loading="lazy" />
      {:else}
        <div class="placeholder">No image yet</div>
      {/if}
    </div>

    <div class="detail-grid">
      <section class="panel">
        <div class="panel-head">
          <span class={`status-pill ${status.state}`}>{status.label}</span>
          <span>{status.detail}</span>
        </div>
        <p class="quiet">{formatRelativeUpdate(detail.freshnessUpdatedAt)} · Confidence {detail.hoursConfidence}</p>
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
        <p>{detail.station ?? 'Area'} · {detail.area ?? detail.address}</p>
        <p class="quiet">{detail.address}</p>
        <div class="button-row">
          <button type="button" on:click={() => dispatch('directions', { id: detail.id })}>Directions</button>
          <button type="button" class:muted={!detail.reserveUrl} disabled={!detail.reserveUrl} on:click={() => dispatch('reserve', { id: detail.id })}>
            Reserve
          </button>
        </div>
      </section>
    </div>
  </aside>
{/if}

<style>
  .detail {
    position: absolute;
    inset: 0;
    background: rgba(246, 241, 232, 0.98);
    z-index: 25;
    overflow: auto;
    padding: 18px 16px calc(28px + env(safe-area-inset-bottom));
    display: grid;
    gap: 16px;
  }

  .detail-header,
  .panel-head,
  .button-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .detail-grid {
    display: grid;
    gap: 16px;
  }

  .eyebrow,
  .secondary,
  .quiet,
  .timeline-row span,
  .timeline-row strong,
  .rating-card span,
  .rating-card small {
    color: rgba(31, 42, 47, 0.7);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  .hero img,
  .placeholder {
    width: 100%;
    aspect-ratio: 1.6;
    border-radius: 24px;
    object-fit: cover;
    background: linear-gradient(135deg, rgba(31, 42, 47, 0.08), rgba(201, 112, 51, 0.16));
    display: grid;
    place-items: center;
  }

  .panel {
    background: rgba(255, 255, 255, 0.88);
    border-radius: 22px;
    padding: 16px;
    display: grid;
    gap: 12px;
    border: 1px solid rgba(31, 42, 47, 0.08);
  }

  .timeline {
    display: grid;
    gap: 8px;
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
    background: rgba(61, 140, 89, 0.14);
    color: #215337;
  }

  .status-pill.closingSoon {
    background: rgba(201, 112, 51, 0.14);
    color: #8d4d21;
  }

  .status-pill.closed {
    background: rgba(123, 123, 116, 0.14);
    color: #62625e;
  }

  .rating-grid {
    display: grid;
    gap: 12px;
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
    background: rgba(201, 112, 51, 0.14);
  }

  .rating-card.google {
    background: rgba(61, 140, 89, 0.14);
  }

  .button-row button,
  .ghost {
    border-radius: 14px;
    border: 0;
    padding: 11px 12px;
    font: inherit;
  }

  .button-row button {
    flex: 1 1 0;
    background: #1f2a2f;
    color: #f6f1e8;
  }

  .button-row button.muted {
    background: rgba(31, 42, 47, 0.1);
    color: rgba(31, 42, 47, 0.44);
  }

  .ghost {
    background: rgba(31, 42, 47, 0.08);
    color: #1f2a2f;
  }
</style>
