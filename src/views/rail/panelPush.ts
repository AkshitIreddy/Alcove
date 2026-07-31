/**
 * src/views/rail/panelPush.ts — how far the world steps aside for a panel.
 *
 * A side panel used to be laid ON TOP of the thing it dressed: the studio
 * sheet covered the shelf's own dock, so the icon you had just pressed was
 * behind the sheet and the bookcase you were recolouring was behind it too.
 * Panels now PUSH — whatever they would have covered slides right by the
 * sheet's own width and slides back when it leaves.
 *
 * The offset is published as custom properties on <html> rather than as
 * per-component state, because the things that move belong to three different
 * components and two stylesheets (the Pixi stage, the cover board, the back
 * arrow). One writer; every consumer is a CSS rule, so an element that mounts
 * mid-slide is already in the right place. Two numbers, because there are two
 * questions:
 *   --nb-panel-push  how much room the world has to give up (the sheet width);
 *   --nb-panel-edge  where the sheet's right side is, in viewport px. Chrome
 *                    pinned to the window corner — the back arrow — is not
 *                    travelling with the book, it is getting out of the
 *                    sheet's lane, and that is a different number.
 * Both are 0 with nothing open.
 *
 * Claims are keyed and the published offset is the LARGEST live one: swapping
 * panels overlaps an outgoing sheet with an incoming one, and two components
 * writing the same number would fight. A single GSAP tween owns it.
 *
 * Timing comes from styles/motion — the same steps RailPanel itself slides on,
 * so the sheet and the world it displaces read as one gesture. Everything the
 * property feeds is a transform: nothing here may reach a layout property,
 * because the pagination pass measures leaf geometry on the same frames.
 */
import { gsap } from 'gsap';
import { tween } from '../../styles/motion';

/** One live claim: how wide the sheet is, and where its right edge lands. */
interface Claim {
  readonly width: number;
  readonly edge: number;
}

/** Live claims, keyed by panel instance. */
const claims = new Map<string, Claim>();

/** The tweened carrier — GSAP animates this, `publish` writes it out. */
const carrier = { push: 0, edge: 0 };

/**
 * Whole pixels only. The stage under this is a canvas; a fractional translate
 * resamples every book on the shelf into a blur for the length of the slide.
 */
function publish(): void {
  const style = document.documentElement.style;
  style.setProperty('--nb-panel-push', `${Math.round(carrier.push)}px`);
  style.setProperty('--nb-panel-edge', `${Math.round(carrier.edge)}px`);
}

function largestClaim(): Claim {
  let widest: Claim = { width: 0, edge: 0 };
  for (const claim of claims.values()) {
    if (claim.width > widest.width) widest = claim;
  }
  return widest;
}

function retarget(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const target = largestClaim();
  const opening = target.width > carrier.push;

  // The flag flips the instant a panel is claimed rather than when the slide
  // finishes, so the settings seal starts leaving with the sheet instead of
  // after it. It is only cleared once the world is fully back.
  if (target.width > 0) root.dataset.nbPanel = 'open';

  gsap.killTweensOf(carrier);
  gsap.to(carrier, {
    push: target.width,
    edge: target.edge,
    // Arriving is the `slow` step (a whole sheet crossing the screen);
    // leaving is a step quicker, matching RailPanel's own two tempos.
    ...tween(opening ? 'slow' : 'normal', opening ? 'enter' : 'exit'),
    onUpdate: publish,
    onComplete: () => {
      publish();
      if (largestClaim().width === 0) delete root.dataset.nbPanel;
    },
  });
}

/**
 * This panel is open: `width` is the room the world must give up, `edge` is
 * where the sheet's right side lands in viewport px (chrome pinned to the
 * window corner clears THAT, not the width). Re-claiming re-measures.
 */
export function claimPanelPush(key: string, width: number, edge: number): void {
  claims.set(key, { width: Math.max(0, width), edge: Math.max(0, edge) });
  retarget();
}

/** This panel is closing (or unmounting) — give the room back. */
export function releasePanelPush(key: string): void {
  if (!claims.delete(key)) return;
  retarget();
}
