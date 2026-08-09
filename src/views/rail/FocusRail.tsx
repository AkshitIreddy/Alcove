/**
 * src/views/rail/FocusRail.tsx — the complete focus-mode control rail.
 *
 * Focus used to leave two unrelated paper plates in the upper-left: an exit
 * chip and a wide dial. They covered the very page the mode exists to clear.
 * This is one narrow rail attached to the window edge, in the same visual
 * family as Settings' chapter rail. It keeps every existing focus control,
 * adds the two routes a reader still needs (Settings and leave), and exists
 * only while focus mode is active.
 */
import { For, Show, type JSX } from 'solid-js';
import type { LeafSide } from '../../flip/PageFlipController';
import { CloseIcon, SettingsIcon } from './icons';
import {
  FOCUS_RUNGS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_REST,
  zoomLabel,
  type FocusLevel,
} from './focusLevels';

export interface FocusRailProps {
  level: FocusLevel;
  onPickLevel(level: FocusLevel): void;
  zoom: number;
  onZoom(direction: 1 | -1): void;
  onZoomRest(): void;
  leaf: LeafSide;
  onPickLeaf(side: LeafSide): void;
  panned: boolean;
  onRecentre(): void;
  onOpenSettings(): void;
  onLeave(): void;
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.7,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

/** One drawing losing a layer at each focus rung: book, leaves, one leaf. */
function RungGlyph(props: { level: FocusLevel }): JSX.Element {
  return (
    <svg viewBox="0 0 26 20" class="nb-focus-rail-glyph" aria-hidden="true">
      <Show when={props.level === 'spread'}>
        <path
          d="M 2.4 3.1 C 6.2 2.4 9.7 2.8 13 4.3 C 16.3 2.8 19.8 2.4 23.6 3.1 C 23.9 8 23.9 12.4 23.5 16.9 C 19.8 16.2 16.3 16.6 13 18 C 9.7 16.6 6.2 16.2 2.5 16.9 C 2.1 12.4 2.1 8 2.4 3.1 Z"
          {...STROKE}
        />
        <path d="M 13 4.4 C 13.1 8.9 13.1 13.4 13 17.9" {...STROKE} stroke-width="1.4" />
      </Show>
      <Show when={props.level === 'page'}>
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
        <path
          d="M 7.3 1.9 C 11.6 1.5 15.2 1.5 19 1.9 C 19.4 7.3 19.4 12.6 19 18.1 C 15.2 18.5 11.6 18.5 7.3 18.1 C 6.9 12.6 6.9 7.3 7.3 1.9 Z"
          {...STROKE}
        />
        <path d="M 10 7.1 C 12.4 6.9 14.4 6.9 16.4 7.1 M 10 10.4 C 12.4 10.2 14.4 10.2 16.4 10.4 M 10 13.7 C 11.8 13.5 13.2 13.5 14.6 13.7" {...STROKE} stroke-width="1.2" />
      </Show>
    </svg>
  );
}

function ZoomGlyph(props: { out?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" class="nb-focus-rail-small-glyph" aria-hidden="true">
      <path d="M 3.4 9.1 C 7.1 8.8 10.9 8.8 14.6 9" {...STROKE} stroke-width="2" />
      <Show when={!props.out}>
        <path d="M 9.1 3.4 C 8.8 7.1 8.8 10.9 9 14.6" {...STROKE} stroke-width="2" />
      </Show>
    </svg>
  );
}

function CentreGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" class="nb-focus-rail-glyph" aria-hidden="true">
      <path d="M 4.3 9 C 4.1 7.2 4.3 5.8 4.9 4.7 C 6 4.2 7.4 4.1 9.1 4.3 M 15 4.3 C 16.8 4.1 18.2 4.3 19.3 4.9 C 19.8 6 19.9 7.4 19.7 9 M 19.7 15 C 19.9 16.8 19.7 18.2 19.1 19.3 C 18 19.8 16.6 19.9 14.9 19.7 M 9 19.7 C 7.2 19.9 5.8 19.7 4.7 19.1 C 4.2 18 4.1 16.6 4.3 14.9" {...STROKE} />
      <path d="M 12 8.7 C 14.1 8.8 15.3 9.9 15.3 12 C 15.2 14 14.1 15.2 12 15.3 C 9.9 15.2 8.8 14.1 8.7 12 C 8.8 9.9 9.9 8.8 12 8.7 Z" {...STROKE} stroke-width="1.4" />
    </svg>
  );
}

function Divider(): JSX.Element {
  return <span class="nb-focus-rail-divider" aria-hidden="true" />;
}

export default function FocusRail(props: FocusRailProps): JSX.Element {
  return (
    <aside class="nb-focus-rail" aria-label="Focus mode controls">
      <div class="nb-focus-rail-group" role="group" aria-label="How much to clear away">
        <For each={FOCUS_RUNGS}>
          {(rung) => (
            <button
              type="button"
              class="nb-focus-rail-button"
              classList={{ 'is-active': props.level === rung.id }}
              aria-pressed={props.level === rung.id}
              aria-label={`${rung.name} — ${rung.blurb}`}
              data-rung={rung.id}
              data-tooltip={`${rung.name} · ${rung.blurb}`}
              data-tooltip-key="[  ]"
              data-tooltip-side="right"
              onClick={() => props.onPickLevel(rung.id)}
            >
              <RungGlyph level={rung.id} />
            </button>
          )}
        </For>
      </div>

      <Divider />

      <div class="nb-focus-rail-group nb-focus-rail-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          class="nb-focus-rail-button"
          aria-label="Zoom out"
          data-tooltip="zoom out"
          data-tooltip-key="Ctrl −"
          data-tooltip-side="right"
          disabled={props.zoom <= ZOOM_MIN}
          onClick={() => props.onZoom(-1)}
        >
          <ZoomGlyph out />
        </button>
        <button
          type="button"
          class="nb-focus-rail-button nb-focus-rail-percent font-ui"
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
          class="nb-focus-rail-button"
          aria-label="Zoom in"
          data-tooltip="zoom in"
          data-tooltip-key="Ctrl +"
          data-tooltip-side="right"
          disabled={props.zoom >= ZOOM_MAX}
          onClick={() => props.onZoom(1)}
        >
          <ZoomGlyph />
        </button>
      </div>

      <Show when={props.level === 'leaf'}>
        <Divider />
        <div class="nb-focus-rail-group nb-focus-rail-leaves" role="group" aria-label="Which page">
          <button
            type="button"
            class="nb-focus-rail-button nb-focus-rail-letter font-ui"
            classList={{ 'is-active': props.leaf === 'left' }}
            aria-pressed={props.leaf === 'left'}
            aria-label="Show left page"
            data-tooltip="left page"
            data-tooltip-side="right"
            onClick={() => props.onPickLeaf('left')}
          >
            L
          </button>
          <button
            type="button"
            class="nb-focus-rail-button nb-focus-rail-letter font-ui"
            classList={{ 'is-active': props.leaf === 'right' }}
            aria-pressed={props.leaf === 'right'}
            aria-label="Show right page"
            data-tooltip="right page"
            data-tooltip-side="right"
            onClick={() => props.onPickLeaf('right')}
          >
            R
          </button>
        </div>
      </Show>

      <Show when={props.panned || props.zoom !== ZOOM_REST}>
        <button
          type="button"
          class="nb-focus-rail-button nb-focus-rail-centre"
          aria-label="Centre the page and reset zoom"
          data-tooltip="centre it again"
          data-tooltip-key="Ctrl 0"
          data-tooltip-side="right"
          onClick={() => props.onRecentre()}
        >
          <CentreGlyph />
        </button>
      </Show>

      <Divider />

      <div class="nb-focus-rail-group nb-focus-rail-actions" role="group" aria-label="Focus mode actions">
        <button
          type="button"
          class="nb-focus-rail-button"
          aria-label="Open Settings"
          aria-haspopup="dialog"
          data-tooltip="settings"
          data-tooltip-key="Ctrl ,"
          data-tooltip-side="right"
          onClick={() => props.onOpenSettings()}
        >
          <SettingsIcon />
        </button>
        <button
          type="button"
          class="nb-focus-rail-button nb-focus-rail-leave"
          aria-label="Leave focus mode (Escape)"
          data-tooltip="leave focus"
          data-tooltip-key="Esc"
          data-tooltip-side="right"
          onClick={() => props.onLeave()}
        >
          <CloseIcon />
        </button>
      </div>
    </aside>
  );
}
