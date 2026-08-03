/**
 * src/views/rail/RailPanel.tsx — the sliding paper sheet the rail's tools
 * open. Mirrors the settings sheet's GSAP pattern (SettingsPanel) but slides
 * in from the LEFT, out of the rail: GSAP owns the rest position (xPercent),
 * never CSS % transforms. Timing comes from the motion scale — a whole sheet
 * crossing the screen is the `slow` step.
 *
 * No scrim — the panel floats beside the rail so the book stays visible and
 * editable (sticker/effect buttons need the editor selection to survive).
 * Escape closes.
 *
 * The sheet does not COVER what it dresses: on the way in it claims its own
 * width from `panelPush`, which slides the shelf/book area right by exactly
 * that much (see panelPush.ts for why the offset is one shared number). The
 * claim is released on close AND on unmount, because leaving a book with a
 * panel open unmounts the sheet without ever closing it.
 *
 * Two children, and the split is the contract: the header is OUTSIDE the
 * scroller and `.nb-rail-panel-body` is the only thing in the sheet that
 * overflows. That is what keeps the × — the way out — on screen at the bottom
 * of a six-thousand-pixel catalogue; the reported bug was "scroll down and
 * there is no way back until you scroll fully up". Do not fold the header into
 * the body and re-pin it with `position: sticky`: a sticky strip is only as
 * reliable as the rules layered over it, and this one cannot move at all.
 * `shots-now/panel-header.mjs` measures it, at both ends of a real scroll, and
 * refuses to pass a panel that does not actually overflow.
 *
 * Focus: opening does NOT steal focus, or a sticker button would lose the
 * editor selection it is about to act on. The exception is a keyboard opener —
 * `:focus-visible` on the rail button is the browser's own answer to "was this
 * a keyboard press", and a keyboard user needs to land inside the sheet or the
 * panel is unreachable. Either way the opener gets focus back on close.
 */
import { createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import { gsap } from 'gsap';
import { tween } from '../../styles/motion';
import { claimPanelPush, releasePanelPush } from './panelPush';
import { CloseIcon } from './icons';

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

/** Every mounted sheet needs its own push claim; five are alive in a book. */
let instances = 0;

export default function RailPanel(props: RailPanelProps): JSX.Element {
  let sheetRef: HTMLElement | undefined;
  const pushKey = `rail-panel-${(instances += 1)}`;
  /** Who to hand focus back to when the sheet leaves. */
  let opener: HTMLElement | null = null;

  onMount(() => {
    if (sheetRef) gsap.set(sheetRef, { xPercent: -130, visibility: 'hidden' });
  });

  onCleanup(() => releasePanelPush(pushKey));

  createEffect<boolean | undefined>((wasOpen) => {
    const open = props.open;
    const sheet = sheetRef;
    if (!sheet || open === wasOpen) return open;
    gsap.killTweensOf(sheet);
    if (open) {
      const active = document.activeElement;
      opener = active instanceof HTMLElement && active !== document.body ? active : null;
      gsap.set(sheet, { visibility: 'visible' });
      // Measured, not assumed: the sheet is `min(340px, 78vw)` and the shelf's
      // is wider still, so both numbers have to come off the real box. The
      // computed `left` is the untransformed one, which is where the sheet is
      // about to come to rest — getBoundingClientRect() at this instant is
      // still reading the parked position off screen.
      const width = sheet.offsetWidth;
      const restLeft = Number.parseFloat(getComputedStyle(sheet).left) || 0;
      claimPanelPush(pushKey, width, restLeft + width);
      gsap.to(sheet, { xPercent: 0, ...tween('slow', 'enter') });
      // Keyboard openers only — see the module docblock.
      if (opener !== null && opener.matches(':focus-visible')) {
        sheet.focus({ preventScroll: true });
      }
    } else if (wasOpen !== undefined) {
      releasePanelPush(pushKey);
      // Focus cannot be left on a sheet that is sliding off screen; hand it
      // back to the icon that opened it so the toggle stays operable.
      const active = document.activeElement;
      if (
        opener !== null &&
        opener.isConnected &&
        (active === document.body || active === null || sheet.contains(active))
      ) {
        opener.focus({ preventScroll: true });
      }
      opener = null;
      // Leaving is a step quicker than arriving — the sheet has already been
      // read by the time it closes.
      gsap.to(sheet, {
        xPercent: -130,
        ...tween('normal', 'exit'),
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
      /* Focusable only on purpose (see the docblock) — never in the tab ring. */
      tabindex={-1}
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
