<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { DailyWindow, PlaceDetail, PlaceStatus } from '$lib/types';

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
  const specialDayLabels = [
    ['publicHoliday', 'Public holiday'],
    ['dayBeforePublicHoliday', 'Day before holiday'],
    ['dayAfterPublicHoliday', 'Day after holiday']
  ] as const;
  const MIDDLE_DOT = '\u00B7';

  function formatLastOrder(window: DailyWindow) {
    const parts: string[] = [];
    if (window.lastOrderDetail?.food) {
      parts.push(`Food ${window.lastOrderDetail.food}`);
    }
    if (window.lastOrderDetail?.drinks) {
      parts.push(`Drinks ${window.lastOrderDetail.drinks}`);
    }
    if (window.lastOrderDetail?.generic && parts.length === 0) {
      parts.push(window.lastOrderDetail.generic);
    }
    if (parts.length === 0 && window.lastOrder) {
      parts.push(window.lastOrder);
    }
    return parts.join(` ${MIDDLE_DOT} `);
  }

  function formatWindow(window: DailyWindow) {
    if (window.allDay) {
      const lastOrder = formatLastOrder(window);
      return lastOrder ? `Open 24 hours (${lastOrder})` : 'Open 24 hours';
    }

    const base = `${window.open} - ${window.close}`;
    const lastOrder = formatLastOrder(window);
    return lastOrder ? `${base} (${lastOrder})` : base;
  }

  function formatWindowList(windows: DailyWindow[]) {
    if (!windows.length) {
      return 'Closed';
    }
    return windows.map((window) => formatWindow(window)).join(` ${MIDDLE_DOT} `);
  }

  $: specialRows =
    detail == null
      ? []
      : specialDayLabels
          .map(([key, label]) => ({ key, label, windows: detail.hoursSpecialDays[key] }))
          .filter((row) => row.windows.length > 0);
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
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" />
        </svg>
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
        {#if status.state === 'closed'}
          <span class="status-copy status-next-open">{status.detail}</span>
        {:else}
          <span class="status-copy">{status.detail}</span>
        {/if}
      </div>
      {#if detail.closure.reason && detail.closure.state !== 'active'}
        <p class="quiet">Closure note: {detail.closure.reason}</p>
      {/if}
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
        <p class="quiet">{detail.hoursDisplay.today}</p>
        <div class="timeline">
          {#each dayLabels as [key, label]}
            <div class="timeline-row">
              <span>{label}</span>
              <strong>{formatWindowList(detail.weeklyTimeline[key])}</strong>
            </div>
          {/each}
          {#each specialRows as row}
            <div class="timeline-row timeline-row-special">
              <span>{row.label}</span>
              <strong>{formatWindowList(row.windows)}</strong>
            </div>
          {/each}
        </div>
        {#if detail.hoursPolicies.length > 0}
          <div class="policy-stack">
            <h4>Notes</h4>
            <ul class="policy-list">
              {#each detail.hoursPolicies as policy}
                <li>{policy}</li>
              {/each}
            </ul>
          </div>
        {/if}
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
  .button-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }

  .panel-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: space-between;
  }

  .detail-grid,
  .rating-grid,
  .timeline,
  .policy-stack {
    display: grid;
    gap: 14px;
  }

  .eyebrow,
  .secondary,
  .quiet,
  .status-copy,
  .timeline-row span,
  .timeline-row strong,
  .rating-card span,
  .rating-card small,
  .policy-list {
    color: rgba(23, 25, 28, 0.68);
  }

  .status-next-open {
    text-align: right;
    margin-left: auto;
  }

  h2,
  h3,
  h4,
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
    grid-template-columns: 112px 1fr;
    gap: 10px;
  }

  .timeline-row-special span {
    font-weight: 600;
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

  .status-pill.closingSoon,
  .status-pill.temporarilyClosed {
    background: rgba(200, 100, 59, 0.14);
    color: #8b4b30;
  }

  .status-pill.closed {
    background: rgba(107, 114, 128, 0.14);
    color: #5a6270;
  }

  .status-pill.permanentlyClosed {
    background: rgba(150, 41, 41, 0.14);
    color: #8a2d2d;
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

  .policy-list {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 8px;
  }

  .button-row button,
  .ghost {
    border-radius: 14px;
    border: 1px solid rgba(23, 25, 28, 0.08);
    padding: 11px 14px;
    font: inherit;
  }

  .button-row button {
    flex: 1 1 0;
    min-height: 42px;
    background: rgba(255, 255, 255, 0.92);
    color: #17191c;
    font-weight: 600;
    box-shadow: 0 6px 18px rgba(17, 24, 39, 0.06);
  }

  .button-row button.muted {
    background: rgba(23, 25, 28, 0.08);
    color: rgba(23, 25, 28, 0.44);
  }

  .ghost {
    min-height: 40px;
    background: rgba(255, 255, 255, 0.78);
    color: #17191c;
    box-shadow: none;
  }

  .ghost-icon {
    width: 40px;
    height: 40px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
  }

  .ghost-icon svg {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
