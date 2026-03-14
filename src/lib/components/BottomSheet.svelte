<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  import type { SheetSnap } from '$lib/types';

  export let snap: SheetSnap = 'mid';
  export let desktop = false;
  export let title = 'Results';

  const dispatch = createEventDispatcher<{ snapchange: { snap: SheetSnap } }>();
  let innerHeight = 800;
  let dragging = false;
  let dragStart = 0;
  let startTop = 0;
  let currentTop = 0;

  function snapTop(next: SheetSnap) {
    if (desktop) {
      return 0;
    }
    if (next === 'peek') {
      return Math.max(120, innerHeight - 164);
    }
    if (next === 'mid') {
      return Math.max(84, innerHeight * 0.42);
    }
    return 72;
  }

  function applySnap(next: SheetSnap) {
    snap = next;
    currentTop = snapTop(next);
    dispatch('snapchange', { snap: next });
  }

  function handlePointerDown(event: PointerEvent) {
    if (desktop) {
      return;
    }

    dragging = true;
    dragStart = event.clientY;
    startTop = currentTop;
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragging || desktop) {
      return;
    }

    const nextTop = Math.min(innerHeight - 120, Math.max(72, startTop + (event.clientY - dragStart)));
    currentTop = nextTop;
  }

  function handlePointerUp() {
    if (!dragging || desktop) {
      return;
    }

    dragging = false;
    const candidates: SheetSnap[] = ['peek', 'mid', 'full'];
    const nearest = candidates.reduce((best, candidate) =>
      Math.abs(snapTop(candidate) - currentTop) < Math.abs(snapTop(best) - currentTop) ? candidate : best
    );
    applySnap(nearest);
  }

  onMount(() => {
    applySnap(snap);
  });

  $: if (!dragging) {
    currentTop = snapTop(snap);
  }
</script>

  <svelte:window bind:innerHeight on:pointermove={handlePointerMove} on:pointerup={handlePointerUp} on:pointercancel={handlePointerUp} />

<section
  class:desktop
  class="sheet"
  style={!desktop ? `transform: translateY(${currentTop}px);` : undefined}
  aria-label={title}
>
  <button
    class="sheet-handle"
    type="button"
    aria-label="Adjust results panel"
    on:pointerdown={handlePointerDown}
    on:click={() => applySnap(snap === 'full' ? 'mid' : snap === 'mid' ? 'peek' : 'full')}
  >
    <span></span>
  </button>
  <div class="sheet-inner">
    <slot />
  </div>
</section>

<style>
  .sheet {
    position: absolute;
    inset: 0 0 auto 0;
    height: calc(100% - 12px);
    background: rgba(246, 241, 232, 0.98);
    border-radius: 28px 28px 0 0;
    box-shadow: 0 -18px 56px rgba(31, 42, 47, 0.2);
    transition: transform 220ms ease;
    will-change: transform;
    display: flex;
    flex-direction: column;
    z-index: 18;
  }

  .sheet.desktop {
    position: relative;
    height: 100%;
    border-radius: 28px 0 0 0;
    transform: none !important;
    box-shadow: none;
    border-left: 1px solid rgba(31, 42, 47, 0.08);
  }

  .sheet-handle {
    display: grid;
    place-items: center;
    height: 32px;
    padding-top: 6px;
    background: transparent;
    border: 0;
    cursor: grab;
    touch-action: none;
  }

  .sheet-handle span {
    width: 48px;
    height: 5px;
    border-radius: 999px;
    background: rgba(31, 42, 47, 0.16);
  }

  .sheet-inner {
    min-height: 0;
    flex: 1;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: 0 16px calc(24px + env(safe-area-inset-bottom));
  }
</style>
