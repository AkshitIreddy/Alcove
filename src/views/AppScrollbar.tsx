/**
 * AppScrollbar — a drawn scrollbar for the app's paper panels.
 *
 * Chromium owns native scrollbar hit-testing outside the page DOM, so a CSS
 * cursor declaration on ::-webkit-scrollbar can still fall back to the Windows
 * arrow. This control keeps the entire drag inside an ordinary element: the
 * selected Alcove cursor remains active, pointer capture makes a drag survive
 * leaving the thumb, and the native scrollport still owns wheel/touch/scroll
 * semantics underneath.
 */
import { onCleanup, onMount, type JSX } from 'solid-js';

let scrollbarIds = 0;

export interface AppScrollbarProps {
  target(): HTMLElement | undefined;
  label: string;
  class?: string;
}

export default function AppScrollbar(props: AppScrollbarProps): JSX.Element {
  const id = `nb-app-scrollport-${(scrollbarIds += 1)}`;
  let track: HTMLDivElement | undefined;
  let thumb: HTMLSpanElement | undefined;
  let target: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  let frame = 0;
  let dragPointer = -1;
  let dragStartY = 0;
  let dragStartScroll = 0;

  const update = (): void => {
    frame = 0;
    if (!track || !thumb || !target) return;
    const viewport = target.clientHeight;
    const extent = target.scrollHeight;
    const range = Math.max(0, extent - viewport);
    const trackHeight = track.clientHeight;
    const shown = range > 1 && trackHeight > 0;
    track.hidden = !shown;
    if (!shown) return;
    const thumbHeight = Math.max(36, Math.min(trackHeight, trackHeight * (viewport / extent)));
    const travel = Math.max(0, trackHeight - thumbHeight);
    const top = range === 0 ? 0 : travel * (target.scrollTop / range);
    thumb.style.height = `${thumbHeight.toFixed(2)}px`;
    thumb.style.transform = `translateY(${top.toFixed(2)}px)`;
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(Math.round(range)));
    track.setAttribute('aria-valuenow', String(Math.round(target.scrollTop)));
  };

  const schedule = (): void => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(update);
  };

  onMount(() => {
    target = props.target();
    if (!target) return;
    target.id ||= id;
    target.classList.add('nb-app-scrollport');
    target.addEventListener('scroll', schedule, { passive: true });
    resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(target);
    for (const child of Array.from(target.children)) resizeObserver.observe(child);
    mutationObserver = new MutationObserver(() => {
      resizeObserver?.disconnect();
      if (target) {
        resizeObserver?.observe(target);
        for (const child of Array.from(target.children)) resizeObserver?.observe(child);
      }
      schedule();
    });
    // Observe structural/content changes, but not attributes. Settings places
    // this scrollbar inside its own scrollport, and `update()` necessarily
    // changes the thumb's style/ARIA attributes; observing those writes would
    // schedule another update forever. ResizeObserver already catches layout
    // changes caused by state/attribute toggles on the panel's children.
    mutationObserver.observe(target, { childList: true, subtree: true, characterData: true });
    schedule();
  });

  onCleanup(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
    target?.removeEventListener('scroll', schedule);
    target?.classList.remove('nb-app-scrollport');
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
  });

  const moveDrag = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointer || !track || !thumb || !target) return;
    const travel = Math.max(1, track.clientHeight - thumb.offsetHeight);
    const range = Math.max(0, target.scrollHeight - target.clientHeight);
    target.scrollTop = dragStartScroll + ((event.clientY - dragStartY) / travel) * range;
  };

  const stopDrag = (event: PointerEvent): void => {
    if (event.pointerId !== dragPointer || !thumb) return;
    if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId);
    dragPointer = -1;
    thumb.classList.remove('is-dragging');
  };

  const pressTrack = (event: PointerEvent): void => {
    if (event.target !== track || !track || !thumb || !target) return;
    event.preventDefault();
    const rect = track.getBoundingClientRect();
    const travel = Math.max(1, rect.height - thumb.offsetHeight);
    const range = Math.max(0, target.scrollHeight - target.clientHeight);
    const wanted = Math.min(travel, Math.max(0, event.clientY - rect.top - thumb.offsetHeight / 2));
    target.scrollTop = (wanted / travel) * range;
  };

  const keyScroll = (event: KeyboardEvent): void => {
    if (!target) return;
    const line = 44;
    const page = Math.max(line, target.clientHeight * 0.82);
    let next: number | null = null;
    if (event.key === 'ArrowUp') next = target.scrollTop - line;
    else if (event.key === 'ArrowDown') next = target.scrollTop + line;
    else if (event.key === 'PageUp') next = target.scrollTop - page;
    else if (event.key === 'PageDown') next = target.scrollTop + page;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = target.scrollHeight;
    if (next === null) return;
    event.preventDefault();
    target.scrollTop = next;
  };

  return (
    <div
      ref={track}
      class={`nb-app-scrollbar ${props.class ?? ''}`}
      role="scrollbar"
      tabindex="0"
      aria-label={props.label}
      aria-controls={target?.id ?? id}
      aria-orientation="vertical"
      onPointerDown={pressTrack}
      onKeyDown={keyScroll}
    >
      <span
        ref={thumb}
        class="nb-app-scrollbar-thumb"
        onPointerDown={(event) => {
          if (!target) return;
          event.preventDefault();
          event.stopPropagation();
          dragPointer = event.pointerId;
          dragStartY = event.clientY;
          dragStartScroll = target.scrollTop;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.classList.add('is-dragging');
        }}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      />
    </div>
  );
}
