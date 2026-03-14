<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  import type { SheetSnap } from '$lib/types';

  export let snap: SheetSnap = 'mid';
  export let desktop = false;
  export let title = 'Results';

  const dispatch = createEventDispatcher<{ snapchange: { snap: SheetSnap } }>();
  let innerHeight = 800;
  let dragging = false;
  let dragMoved = false;
  let dragStart = 0;
  let startTop = 0;
  let currentTop = 0;
  let lastPointerY = 0;
  let lastPointerTs = 0;
  let dragVelocity = 0;
  let activePointerId: number | null = null;
  let handleElement: HTMLButtonElement;
  function snapTop(next: SheetSnap) {
    if (desktop) {
      return 0;
    }
    if (next === 'peek') {
      return Math.max(96, innerHeight - 214);
    }
    if (next === 'mid') {
      return Math.max(72, innerHeight * 0.4);
    }
    return 48;
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

    event.preventDefault();
    activePointerId = event.pointerId;
    dragMoved = false;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
    dragging = true;
    dragStart = event.clientY;
    startTop = currentTop;
    lastPointerY = event.clientY;
    lastPointerTs = event.timeStamp;
    dragVelocity = 0;
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragging || desktop || event.pointerId !== activePointerId) {
      return;
    }

    event.preventDefault();
    const deltaY = event.clientY - dragStart;
    const frameDelta = event.clientY - lastPointerY;
    const frameTime = Math.max(1, event.timeStamp - lastPointerTs);
    dragVelocity = frameDelta / frameTime;
    lastPointerY = event.clientY;
    lastPointerTs = event.timeStamp;
    dragMoved = dragMoved || Math.abs(deltaY) > 6;

    const nextTop = Math.min(innerHeight - 120, Math.max(48, startTop + deltaY));
    currentTop = nextTop;
  }

  function resolveSnap() {
    if (dragVelocity > 0.55) {
      if (currentTop < snapTop('mid')) {
        return 'mid';
      }
      return 'peek';
    }

    if (dragVelocity < -0.55) {
      if (currentTop > snapTop('mid')) {
        return 'mid';
      }
      return 'full';
    }

    const candidates: SheetSnap[] = ['peek', 'mid', 'full'];
    return candidates.reduce((best, candidate) =>
      Math.abs(snapTop(candidate) - currentTop) < Math.abs(snapTop(best) - currentTop) ? candidate : best
    );
  }

  function handlePointerUp(event?: PointerEvent) {
    if (!dragging || desktop || (event && event.pointerId !== activePointerId)) {
      return;
    }

    dragging = false;
    if (activePointerId !== null) {
      handleElement?.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    applySnap(resolveSnap());
  }

  function handleHandleClick(event: MouseEvent) {
    if (dragMoved) {
      event.preventDefault();
      dragMoved = false;
      return;
    }

    applySnap(snap === 'full' ? 'mid' : snap === 'mid' ? 'peek' : 'full');
  }

  onMount(() => {
    applySnap(snap);
  });

  $: if (!dragging) {
    currentTop = snapTop(snap);
  }
</script>

  <svelte:window bind:innerHeight on:pointerup={handlePointerUp} on:pointercancel={handlePointerUp} />

<section
  class:desktop
  class:snap-peek={snap === 'peek'}
  class:snap-mid={snap === 'mid'}
  class:snap-full={snap === 'full'}
  class="sheet"
  style={!desktop ? `transform: translateY(${currentTop}px);` : undefined}
  aria-label={title}
>
  <button
    bind:this={handleElement}
    class="sheet-handle"
    type="button"
    aria-label="Adjust results panel"
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
    on:pointercancel={handlePointerUp}
    on:click={handleHandleClick}
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
    background: color-mix(in srgb, var(--sheet-bg) 90%, white 10%);
    backdrop-filter: blur(18px);
    border-radius: 28px 28px 0 0;
    box-shadow: 0 -20px 52px rgba(17, 24, 39, 0.16);
    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), border-radius 180ms ease;
    will-change: transform;
    display: flex;
    flex-direction: column;
    z-index: 18;
    border-top: 1px solid rgba(255, 255, 255, 0.65);
    overscroll-behavior-y: none;
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
    width: 100%;
    height: 44px;
    padding-top: 10px;
    background: transparent;
    border: 0;
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  .sheet-handle span {
    width: 44px;
    height: 5px;
    border-radius: 999px;
    background: rgba(23, 25, 28, 0.16);
  }

  .sheet-inner {
    min-height: 0;
    flex: 1;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
    padding: 0 16px calc(26px + env(safe-area-inset-bottom));
  }

  .sheet.snap-full {
    border-radius: 24px 24px 0 0;
  }
</style>
