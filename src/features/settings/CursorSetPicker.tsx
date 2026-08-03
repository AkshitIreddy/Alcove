/**
 * features/settings/CursorSetPicker.tsx — choosing the pointer.
 *
 * A row of cards rather than a row of words. Every other pick in this sheet is
 * a name for something you cannot see until you commit to it; a cursor set is
 * the one choice whose whole content is a picture, and the picture is small
 * enough to print at full size. So each card carries the set's own arrow at
 * exactly the size it will be on screen — 32px, 40 for Bold — standing half on
 * cream page and half on shelf timber, because those are the two grounds it
 * has to survive and a set that only works on one of them should be caught
 * here rather than by the reader.
 *
 * Under the row, the chosen set's other thirteen states. Not decoration: the
 * pointer is the one control surface a reader cannot inspect by looking at it
 * (it is under their hand, at 32 pixels, and it changes as they move), so
 * "what am I actually getting" is otherwise only answerable by going and
 * hovering a resize handle.
 *
 * `system` is a card in the same row as the rest, not a reset button beside
 * them. Someone with a Windows accessibility cursor scheme has already made
 * this choice and the app's job is to offer to stay out of the way, in the
 * same voice it offers everything else.
 */

import { For, Show, type JSX } from 'solid-js';
import {
  CURSOR_ROLES,
  CURSOR_SETS,
  CURSOR_SET_IDS,
  cursorImage,
  type CursorSetId,
} from '../../art/cursors';

/**
 * A neutral outline arrow standing in for "whatever Windows draws".
 *
 * Deliberately NOT in the app's flat language — no cream fill, no ink outline,
 * no bow. This card is the one that promises the app will not draw the cursor,
 * and a house-style arrow on it would be a picture of the opposite.
 */
function SystemArrow(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M 5 3 L 5 19 L 9.2 14.9 L 12 21 L 14.8 19.7 L 12.1 13.9 L 17.6 13.6 Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** The state strip's captions, so the swatches are not a guessing game. */
const ROLE_LABELS: Readonly<Record<string, string>> = {
  default: 'pointing at things',
  pointer: 'over something you can click',
  text: 'over writing',
  grab: 'over a book you can pull out',
  grabbing: 'while you are dragging it',
  'not-allowed': 'where it cannot go',
  'ew-resize': 'widening a column',
  'ns-resize': 'changing a height',
  'nwse-resize': 'resizing a corner',
  'nesw-resize': 'resizing the other corner',
  move: 'moving something whole',
  'zoom-in': 'zooming in',
  'zoom-out': 'zooming out',
  progress: 'while the app is working',
  crosshair: 'aiming at an exact spot',
  help: 'over something that explains itself',
};

export default function CursorSetPicker(props: {
  value: CursorSetId;
  onSelect: (next: CursorSetId) => void;
}): JSX.Element {
  return (
    <div class="nb-cursorset-group">
      <div class="nb-cursorset" role="radiogroup" aria-label="cursor set">
        <For each={CURSOR_SET_IDS}>
          {(id) => {
            const spec = CURSOR_SETS[id];
            const image = cursorImage(id, 'default');
            return (
              <button
                type="button"
                role="radio"
                class="nb-cursorset-card"
                aria-checked={props.value === id}
                aria-label={`${spec.name} cursors`}
                data-tooltip={spec.blurb}
                onClick={() => props.onSelect(id)}
              >
                <span
                  class="nb-cursorset-plate"
                  classList={{ 'nb-cursorset-plate--system': image === null }}
                >
                  <Show when={image} fallback={<SystemArrow />}>
                    {(img) => (
                      <img
                        src={img().url}
                        width={img().size}
                        height={img().size}
                        alt=""
                      />
                    )}
                  </Show>
                </span>
                <span class="nb-cursorset-name font-ui">{spec.name}</span>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={props.value !== 'system'}>
        <div
          class="nb-cursorset-states"
          role="list"
          aria-label={`${CURSOR_SETS[props.value].name} cursor states`}
        >
          {/* `image` is an ACCESSOR, not a value. `<For>` over a constant list
              builds each row once and keeps it, so a value read here would be
              the first set the reader ever selected, frozen — the strip would
              go on showing Scriptorium's nib after they moved to Drafting. */}
          <For each={CURSOR_ROLES}>
            {(role) => {
              const image = (): ReturnType<typeof cursorImage> =>
                cursorImage(props.value, role);
              return (
                <Show when={image()}>
                  {(img) => (
                    <span
                      class="nb-cursorset-state"
                      role="listitem"
                      data-tooltip={ROLE_LABELS[role] ?? role}
                    >
                      <img
                        src={img().url}
                        width={img().size}
                        height={img().size}
                        alt={ROLE_LABELS[role] ?? role}
                      />
                    </span>
                  )}
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
