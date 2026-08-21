/**
 * src/views/rail/OwnColour.tsx — "a colour of your own", for the two studios.
 *
 * ## Why this exists
 *
 * Every colour chooser in the studios offers a VOCABULARY: fifty book cloths,
 * sixty room schemes. A vocabulary is the right shape for browsing and the
 * wrong shape for the reader who arrives already knowing what they want, and
 * the report that prompted this was exactly that — "at least 20, plus a way for
 * the reader to enter their own". Breadth alone does not answer the second
 * half: there is no number of curated colours that contains somebody's own.
 *
 * ## Why it is one component and not two
 *
 * `editor/nodes/callout.tsx` already ships this control for callout washes, and
 * it is the precedent this follows down to the behaviours that look like
 * details and are not:
 *
 *  - a half-typed hex is NEVER overwritten with a default (`normaliseHex`
 *    returning null means "leave the reader's field alone", not "fall back");
 *  - a committed colour is remembered in the shared custom-colour store even
 *    though this compact studio control does not repeat those colours as a
 *    second swatch grid.
 *
 * Writing the input/validation path again inline would still give the studios
 * their own drift, so both logical homes share this one compact picker.
 *
 * ## What it does NOT do
 *
 * It does not clamp, fold or judge the colour. That belongs to whoever paints
 * it — `palette.clothPair` for a book's cloth, `palette.caseFaces` for timber —
 * because the clamp is different in each case and a picker that pre-clamped
 * would show the reader one colour and paint another.
 */
import { Show, createSignal, onCleanup, type JSX } from 'solid-js';
import {
  normaliseHex,
  rememberCustomColour,
} from '../../art/customColour';
import { copyColour, pasteColour } from './colourClipboard';

export interface ColourClipboardActionsProps {
  /** Names the colour role in button announcements. */
  label: string;
  /** The currently visible/selected colour copied by the first action. */
  value: string;
  /** Applies a pasted canonical hex to this picker. */
  onPaste(hex: string): void;
  /** Tighter treatment for the small key-colour cards. */
  compact?: boolean;
}

/** Shared copy/paste actions for every colour well in the studios. */
export function ColourClipboardActions(props: ColourClipboardActionsProps): JSX.Element {
  const [status, setStatus] = createSignal<'copied' | 'pasted' | 'empty' | null>(null);
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (statusTimer !== undefined) clearTimeout(statusTimer);
  });

  const say = (next: 'copied' | 'pasted' | 'empty'): void => {
    setStatus(next);
    if (statusTimer !== undefined) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => setStatus(null), 1800);
  };

  const copy = async (): Promise<void> => {
    say((await copyColour(props.value)) === null ? 'empty' : 'copied');
  };

  const paste = async (): Promise<void> => {
    const hex = await pasteColour();
    if (hex === null) {
      say('empty');
      return;
    }
    rememberCustomColour(hex);
    props.onPaste(hex);
    say('pasted');
  };

  return (
    <span
      class="nb-colour-clipboard-actions"
      classList={{ 'is-compact': props.compact === true }}
      role="group"
      aria-label={`${props.label}: colour clipboard`}
      aria-live="polite"
    >
      <button
        type="button"
        class="nb-colour-clipboard-button font-ui"
        aria-label={`${props.label}: copy ${props.value.toUpperCase()}`}
        data-tooltip={`copy ${props.value.toUpperCase()}`}
        onClick={() => void copy()}
      >
        {status() === 'copied' ? 'copied' : 'copy'}
      </button>
      <button
        type="button"
        class="nb-colour-clipboard-button font-ui"
        aria-label={`${props.label}: paste a copied colour`}
        data-tooltip="paste colour"
        onClick={() => void paste()}
      >
        {status() === 'pasted' ? 'pasted' : status() === 'empty' ? 'no colour' : 'paste'}
      </button>
    </span>
  );
}

export interface OwnColourProps {
  /** Names the group for assistive tech: "Your own colour for the shelves". */
  label: string;
  /** The colour in force now — the well opens on it. Null = none chosen. */
  value: string | null;
  /**
   * The colour in force RIGHT NOW as a plain hex — the reader's own when there
   * is one, otherwise the named one it would replace.
   *
   * The well opens on it (a native colour input has to open on something, and
   * opening every one of them on black makes the control look like it is about
   * to paint the book black) and the text field shows it greyed, which answers
   * "what am I replacing" without the reader having to go and look.
   */
  fallback: string;
  onPick(hex: string): void;
  /** Offered only when `value` is non-null: back to the named vocabulary. */
  onClear(): void;
  /** What the clear button says — "back to the pigment" / "back to the room". */
  clearLabel: string;
}

export default function OwnColour(props: OwnColourProps): JSX.Element {
  const [draft, setDraft] = createSignal('');
  const legal = (): string | null => normaliseHex(draft());

  const commit = (value: unknown): void => {
    const hex = normaliseHex(value);
    // Unreadable input leaves the field exactly as it was typed. Writing a
    // default over somebody's half-finished colour is the one thing a picker
    // must never do — see `normaliseHex`'s own contract.
    if (hex === null) return;
    rememberCustomColour(hex);
    props.onPick(hex);
    setDraft('');
  };

  return (
    <div class="nb-own-colour">
      {/*
        Captioned, not just separated by the hairline. Under the book studio's
        pigment grid an uncaptioned well reads as a fifty-first swatch that
        happens to be a form field; the studio's other groups all say what they
        are (`nb-strip-label`), and this is the one that most needs to, because
        what it offers is not on the shelf above it.
      */}
      <p class="nb-panel-row-label nb-strip-label nb-own-colour-title font-ui">
        or a colour of your own
      </p>
      <div class="nb-own-colour-entry">
        {/*
          The native well. It is the one control in the studio that is not
          hand-drawn, and that is deliberate: it opens the operating system's
          eyedropper and colour wheel, which is the thing a reader actually
          wants here and which no amount of drawing gets us.
        */}
        <input
          type="color"
          class="nb-own-colour-well"
          aria-label={`${props.label}: pick a colour`}
          value={props.value ?? props.fallback}
          onChange={(event) => commit(event.currentTarget.value)}
        />
        <input
          type="text"
          class="nb-own-colour-hex font-ui"
          inputMode="text"
          spellcheck={false}
          maxLength={7}
          placeholder={props.fallback}
          aria-label={`${props.label}: as a hex code`}
          aria-invalid={draft() !== '' && legal() === null}
          classList={{ 'is-bad': draft() !== '' && legal() === null }}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          /*
            `on:keydown`, NOT `onKeyDown`. Both studios guard their root with
            `stopShelfKeys` bound the same way, because the shelf's own Enter
            pulls a book off the wall; a real listener there stops the event
            while it is still climbing, so a DELEGATED handler inside — which
            runs at `document` — never sees it at all. Written as `onKeyDown`
            first: the field took the hex, Enter did nothing, and the reader
            was left with a colour typed and no way to apply it but the button.
            See shelfKeys.ts, which says so in as many words.
          */
          on:keydown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commit(draft());
          }}
        />
        <button
          type="button"
          class="nb-chip nb-chip-gilt"
          disabled={legal() === null}
          aria-label={`${props.label}: use this colour`}
          onClick={() => commit(draft())}
        >
          use it
        </button>
        <ColourClipboardActions
          label={props.label}
          value={props.value ?? props.fallback}
          onPaste={commit}
        />
        <Show when={props.value !== null}>
          <button type="button" class="nb-chip nb-chip-ghost" onClick={() => props.onClear()}>
            {props.clearLabel}
          </button>
        </Show>
      </div>
    </div>
  );
}
