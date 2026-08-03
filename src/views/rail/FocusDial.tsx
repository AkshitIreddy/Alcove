/**
 * src/views/rail/FocusDial.tsx — the reader's hand on focus mode.
 *
 * A small paper plate that only exists while focus mode does, pinned TOP-LEFT
 * under the exit chip (the app's one corner — see the convention docblock in
 * `views/BookView.tsx` and `tests/top-left-exits.test.ts`). It carries the two
 * things the reader asked to control:
 *
 *   - the rung: the book → the pages → one page (`focusLevels.ts`)
 *   - the zoom: 60% to 240%, with the way back to 100% one press away
 *
 * and, once there is only one leaf on screen, which leaf that is.
 *
 * Every control here is also a keystroke, and the plate says so rather than
 * hiding it: `[` `]` walk the rungs, `Ctrl −` `Ctrl +` `Ctrl 0` work the zoom,
 * `Esc` leaves. A dial that has to stay open to be usable would be one more
 * thing in front of the page focus mode exists to clear.
 */
import { For, Show, type JSX } from 'solid-js';
import type { LeafSide } from '../../flip/PageFlipController';
import {
  FOCUS_RUNGS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_REST,
  zoomLabel,
  type FocusLevel,
} from './focusLevels';

export interface FocusDialProps {
  level: FocusLevel;
  onPickLevel(level: FocusLevel): void;
  zoom: number;
  onZoom(direction: 1 | -1): void;
  onZoomRest(): void;
  /** Which leaf survives at the `leaf` rung. */
  leaf: LeafSide;
  onPickLeaf(side: LeafSide): void;
  /** True while the reader has dragged the zoomed book off centre. */
  panned: boolean;
  onRecentre(): void;
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.7,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

/**
 * One glyph per rung, and they are the same drawing losing a layer each time:
 * a bound book, then the boards taken off, then one leaf. Pre-wobbled paths in
 * a 26×20 frame — no runtime distortion, same as everything in `rail/icons`.
 */
function RungGlyph(props: { level: FocusLevel }): JSX.Element {
  return (
    <svg viewBox="0 0 26 20" class="nb-focus-rung-glyph" aria-hidden="true">
      <Show when={props.level === 'spread'}>
        {/* boards + both leaves + the crease */}
        <path
          d="M 2.4 3.1 C 6.2 2.4 9.7 2.8 13 4.3 C 16.3 2.8 19.8 2.4 23.6 3.1 C 23.9 8 23.9 12.4 23.5 16.9 C 19.8 16.2 16.3 16.6 13 18 C 9.7 16.6 6.2 16.2 2.5 16.9 C 2.1 12.4 2.1 8 2.4 3.1 Z"
          {...STROKE}
        />
        <path d="M 13 4.4 C 13.1 8.9 13.1 13.4 13 17.9" {...STROKE} stroke-width="1.4" />
      </Show>
      <Show when={props.level === 'page'}>
        {/* two bare leaves, no board around them */}
        <path
          d="M 4.2 2.7 C 7.4 2.4 10 2.4 12.3 2.7 C 12.6 7.5 12.6 12.3 12.3 17.2 C 10 17.5 7.4 17.5 4.2 17.2 C 3.9 12.3 3.9 7.5 4.2 2.7 Z"
          {...STROKE}
        />
        <path
          d="M 13.8 2.7 C 16.9 2.4 19.6 2.4 21.9 2.7 C 22.2 7.5 22.2 12.3 21.9 17.2 C 19.6 17.5 16.9 17.5 13.8 17.2 C 13.5 12.3 13.5 7.5 13.8 2.7 Z"
          {...STROKE}
        />
      </Show>
      <Show when={props.level === 'leaf'}>
        {/* one leaf, and a couple of ruled lines because it is all that is left */}
        <path
          d="M 7.3 1.9 C 11.6 1.5 15.2 1.5 19 1.9 C 19.4 7.3 19.4 12.6 19 18.1 C 15.2 18.5 11.6 18.5 7.3 18.1 C 6.9 12.6 6.9 7.3 7.3 1.9 Z"
          {...STROKE}
        />
        <path d="M 10 7.1 C 12.4 6.9 14.4 6.9 16.4 7.1" {...STROKE} stroke-width="1.2" />
        <path d="M 10 10.4 C 12.4 10.2 14.4 10.2 16.4 10.4" {...STROKE} stroke-width="1.2" />
        <path d="M 10 13.7 C 11.8 13.5 13.2 13.5 14.6 13.7" {...STROKE} stroke-width="1.2" />
      </Show>
    </svg>
  );
}

function ZoomGlyph(props: { out?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" class="nb-focus-zoom-glyph" aria-hidden="true">
      <path d="M 3.3 8.1 C 6.4 7.9 9.6 7.9 12.7 8" {...STROKE} stroke-width="1.9" />
      <Show when={!props.out}>
        <path d="M 8.1 3.3 C 7.9 6.4 7.9 9.6 8 12.7" {...STROKE} stroke-width="1.9" />
      </Show>
    </svg>
  );
}

export default function FocusDial(props: FocusDialProps): JSX.Element {
  return (
    <div class="nb-focus-dial" role="group" aria-label="Focus mode">
      <div class="nb-focus-rungs" role="group" aria-label="How much to clear away">
        <For each={FOCUS_RUNGS}>
          {(rung) => (
            <button
              type="button"
              class="nb-focus-rung"
              classList={{ 'is-active': props.level === rung.id }}
              aria-pressed={props.level === rung.id}
              aria-label={`${rung.name} — ${rung.blurb}`}
              data-rung={rung.id}
              data-tooltip={rung.blurb}
              data-tooltip-side="right"
              onClick={() => props.onPickLevel(rung.id)}
            >
              <RungGlyph level={rung.id} />
              <span class="nb-focus-rung-name font-ui">{rung.name}</span>
            </button>
          )}
        </For>
      </div>

      <div class="nb-focus-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          class="nb-focus-zoom-step"
          aria-label="Zoom out"
          data-tooltip="smaller"
          data-tooltip-key="Ctrl −"
          data-tooltip-side="right"
          disabled={props.zoom <= ZOOM_MIN}
          onClick={() => props.onZoom(-1)}
        >
          <ZoomGlyph out />
        </button>
        <button
          type="button"
          class="nb-focus-zoom-value font-ui"
          aria-label={`Zoom ${zoomLabel(props.zoom)} — back to 100%`}
          data-tooltip="back to 100%"
          data-tooltip-key="Ctrl 0"
          data-tooltip-side="right"
          onClick={() => props.onZoomRest()}
        >
          {zoomLabel(props.zoom)}
        </button>
        <button
          type="button"
          class="nb-focus-zoom-step"
          aria-label="Zoom in"
          data-tooltip="bigger"
          data-tooltip-key="Ctrl +"
          data-tooltip-side="right"
          disabled={props.zoom >= ZOOM_MAX}
          onClick={() => props.onZoom(1)}
        >
          <ZoomGlyph />
        </button>
      </div>

      <Show when={props.level === 'leaf'}>
        <div class="nb-focus-leafpick" role="group" aria-label="Which page">
          <button
            type="button"
            class="nb-focus-leaf-button font-ui"
            classList={{ 'is-active': props.leaf === 'left' }}
            aria-pressed={props.leaf === 'left'}
            onClick={() => props.onPickLeaf('left')}
          >
            left
          </button>
          <button
            type="button"
            class="nb-focus-leaf-button font-ui"
            classList={{ 'is-active': props.leaf === 'right' }}
            aria-pressed={props.leaf === 'right'}
            onClick={() => props.onPickLeaf('right')}
          >
            right
          </button>
        </div>
      </Show>

      <Show when={props.panned || props.zoom !== ZOOM_REST}>
        <button
          type="button"
          class="nb-focus-recentre font-ui"
          onClick={() => props.onRecentre()}
        >
          centre it again
        </button>
      </Show>

      <p class="nb-focus-dial-keys font-ui">
        <kbd>[</kbd>
        <kbd>]</kbd>
        <span>rungs</span>
        <kbd>Ctrl</kbd>
        <kbd>±</kbd>
        <span>zoom</span>
      </p>
    </div>
  );
}
