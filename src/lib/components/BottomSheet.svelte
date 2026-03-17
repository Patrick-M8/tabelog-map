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
  let lastInputY = 0;
  let lastInputTs = 0;
  let dragVelocity = 0;
  let activePointerId: number | null = null;
  let activePointerElement: HTMLElement | null = null;
  let contentDragCandidate = false;
  let topZoneDragCandidate = false;
  let touchActive = false;
  let sheetInnerElement: HTMLDivElement;

  function isInteractiveTarget(target: EventTarget | null) {
    return target instanceof HTMLElement && target.closest('button, a, input, select, textarea, [role="button"]') !== null;
  }

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

  function primeDrag(clientY: number, timeStamp: number) {
    dragMoved = false;
    dragStart = clientY;
    startTop = currentTop;
    lastInputY = clientY;
    lastInputTs = timeStamp;
    dragVelocity = 0;
  }

  function updateDrag(clientY: number, timeStamp: number) {
    const deltaY = clientY - dragStart;
    const frameDelta = clientY - lastInputY;
    const frameTime = Math.max(1, timeStamp - lastInputTs);
    dragVelocity = frameDelta / frameTime;
    lastInputY = clientY;
    lastInputTs = timeStamp;
    dragMoved = dragMoved || Math.abs(deltaY) > 6;

    const nextTop = Math.min(innerHeight - 120, Math.max(48, startTop + deltaY));
    currentTop = nextTop;
  }

  function releaseActivePointer() {
    if (activePointerElement && activePointerId !== null) {
      try {
        if (activePointerElement.hasPointerCapture(activePointerId)) {
          activePointerElement.releasePointerCapture(activePointerId);
        }
      } catch {
        // Ignore release errors from browsers that already cleared the capture.
      }
    }

    activePointerElement = null;
    activePointerId = null;
  }

  function resetGestureState() {
    releaseActivePointer();
    contentDragCandidate = false;
    topZoneDragCandidate = false;
    touchActive = false;
  }

  function shouldUseTopZoneDrag(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (isInteractiveTarget(target)) {
      return false;
    }

    return target.closest('[data-sheet-drag-zone]') !== null;
  }

  function capturePointer(event: PointerEvent, element: HTMLElement) {
    activePointerId = event.pointerId;
    activePointerElement = element;

    try {
      if (!element.hasPointerCapture(event.pointerId)) {
        element.setPointerCapture(event.pointerId);
      }
    } catch {
      // Ignore capture errors from browsers that do not support capture on the target.
    }
  }

  function beginDragWithPointer(event: PointerEvent, element: HTMLElement) {
    dragging = true;
    capturePointer(event, element);
  }

  function beginDragWithoutPointer() {
    dragging = true;
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

  function finishDrag() {
    if (!dragging) {
      resetGestureState();
      return;
    }

    const nextSnap = resolveSnap();
    dragging = false;
    resetGestureState();
    applySnap(nextSnap);
  }

  function maybeStartContentDrag(clientY: number) {
    const deltaY = clientY - dragStart;
    if (topZoneDragCandidate) {
      if (Math.abs(deltaY) <= 2) {
        return false;
      }

      beginDragWithoutPointer();
      return true;
    }

    if (deltaY < -4) {
      contentDragCandidate = false;
      return false;
    }

    if (deltaY <= 2) {
      return false;
    }

    if ((sheetInnerElement?.scrollTop ?? 0) > 0) {
      return false;
    }

    beginDragWithoutPointer();
    return true;
  }

  function handleHandlePointerDown(event: PointerEvent) {
    if (desktop || touchActive) {
      return;
    }

    event.preventDefault();
    primeDrag(event.clientY, event.timeStamp);
    beginDragWithPointer(event, event.currentTarget as HTMLElement);
  }

  function handleContentPointerDown(event: PointerEvent) {
    if (desktop || touchActive) {
      return;
    }

    if (isInteractiveTarget(event.target)) {
      return;
    }

    primeDrag(event.clientY, event.timeStamp);
    capturePointer(event, event.currentTarget as HTMLElement);
    contentDragCandidate = true;
    topZoneDragCandidate = shouldUseTopZoneDrag(event.target);
  }

  function handleWindowPointerMove(event: PointerEvent) {
    if (desktop || touchActive || activePointerId === null || event.pointerId !== activePointerId) {
      return;
    }

    if (!dragging) {
      if (!contentDragCandidate || !maybeStartContentDrag(event.clientY)) {
        return;
      }
    }

    event.preventDefault();
    updateDrag(event.clientY, event.timeStamp);
  }

  function handlePointerUp(event?: PointerEvent) {
    if (desktop || touchActive || (event && activePointerId !== null && event.pointerId !== activePointerId)) {
      return;
    }

    finishDrag();
  }

  function handleHandleTouchStart(event: TouchEvent) {
    if (desktop) {
      return;
    }

    const touch = event.touches[0];
    if (!touch) {
      return;
    }

    touchActive = true;
    primeDrag(touch.clientY, event.timeStamp);
    beginDragWithoutPointer();
  }

  function handleContentTouchStart(event: TouchEvent) {
    if (desktop) {
      return;
    }

    if (isInteractiveTarget(event.target)) {
      return;
    }

    const touch = event.touches[0];
    if (!touch) {
      return;
    }

    touchActive = true;
    primeDrag(touch.clientY, event.timeStamp);
    contentDragCandidate = true;
    topZoneDragCandidate = shouldUseTopZoneDrag(event.target);
  }

  function handleWindowTouchMove(event: TouchEvent) {
    if (desktop || !touchActive) {
      return;
    }

    const touch = event.touches[0];
    if (!touch) {
      return;
    }

    if (!dragging) {
      if (!contentDragCandidate || !maybeStartContentDrag(touch.clientY)) {
        return;
      }
    }

    event.preventDefault();
    updateDrag(touch.clientY, event.timeStamp);
  }

  function handleTouchEnd() {
    if (desktop || !touchActive) {
      return;
    }

    finishDrag();
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

<svelte:window
  bind:innerHeight
  on:pointermove={handleWindowPointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
  on:touchmove|nonpassive={handleWindowTouchMove}
  on:touchend={handleTouchEnd}
  on:touchcancel={handleTouchEnd}
/>

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
    class="sheet-handle"
    type="button"
    aria-label="Adjust results panel"
    on:pointerdown={handleHandlePointerDown}
    on:touchstart|nonpassive={handleHandleTouchStart}
    on:click={handleHandleClick}
  >
    <span></span>
  </button>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={sheetInnerElement}
    class="sheet-inner"
    on:pointerdown={handleContentPointerDown}
    on:touchstart|nonpassive={handleContentTouchStart}
  >
    <slot />
  </div>
</section>

<style>
  .sheet {
    position: absolute;
    inset: 0 0 auto 0;
    height: calc(100% - 8px);
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
    height: 30px;
    padding: 8px 0 6px;
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
    height: 6px;
    border-radius: 999px;
    background: rgba(23, 25, 28, 0.18);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.5),
      inset 0 0 0 0.5px rgba(23, 25, 28, 0.04);
  }

  .sheet-inner {
    min-height: 0;
    flex: 1;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
    touch-action: pan-y;
    padding: 0 14px calc(24px + env(safe-area-inset-bottom));
  }

  .sheet.snap-full {
    border-radius: 24px 24px 0 0;
  }

  .sheet.desktop .sheet-handle {
    display: none;
  }
</style>
