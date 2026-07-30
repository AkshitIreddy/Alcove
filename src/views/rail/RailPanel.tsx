/**
 * src/views/rail/RailPanel.tsx — the sliding paper sheet the rail's tools
 * open. Mirrors the settings sheet's GSAP pattern (SettingsPanel) but slides
 * in from the LEFT, out of the rail: GSAP owns the rest position (xPercent),
 * never CSS % transforms, durations scaled by --motion-scale.
 *
 * No scrim — the panel floats beside the rail so the book stays visible and
 * editable (sticker/effect buttons need the editor selection to survive).
 * Escape closes.
 */
import { createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import { gsap } from 'gsap';
import { CloseIcon } from './icons';

function motionScale(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--motion-scale')
    .trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 1;
}

export interface RailPanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: JSX.Element;
  /**
   * Extra class on the sheet. The shelf uses `is-shelf` — there is no icon
   * rail out there, so the sheet hugs the window edge instead of the rail.
   */
  panelClass?: string;
}

export default function RailPanel(props: RailPanelProps): JSX.Element {
  let sheetRef: HTMLElement | undefined;

  onMount(() => {
    if (sheetRef) gsap.set(sheetRef, { xPercent: -130, visibility: 'hidden' });
  });

  createEffect<boolean | undefined>((wasOpen) => {
    const open = props.open;
    const sheet = sheetRef;
    if (!sheet || open === wasOpen) return open;
    const dur = 0.45 * motionScale();
    gsap.killTweensOf(sheet);
    if (open) {
      gsap.set(sheet, { visibility: 'visible' });
      gsap.to(sheet, { xPercent: 0, duration: dur, ease: 'power3.out' });
    } else if (wasOpen !== undefined) {
      gsap.to(sheet, {
        xPercent: -130,
        duration: dur * 0.8,
        ease: 'power2.in',
        onComplete: () => gsap.set(sheet, { visibility: 'hidden' }),
      });
    }
    return open;
  }, undefined);

  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  return (
    <aside
      class="nb-rail-panel"
      classList={{ [props.panelClass ?? '']: props.panelClass !== undefined }}
      ref={(el) => (sheetRef = el)}
      role="dialog"
      aria-label={props.title}
      aria-hidden={!props.open}
    >
      <header class="nb-rail-panel-header">
        <h2 class="nb-rail-panel-title">{props.title}</h2>
        <button
          type="button"
          class="nb-rail-panel-close"
          aria-label={`Close ${props.title}`}
          onClick={() => props.onClose()}
        >
          <CloseIcon />
        </button>
      </header>
      <div class="nb-rail-panel-body">{props.children}</div>
    </aside>
  );
}
