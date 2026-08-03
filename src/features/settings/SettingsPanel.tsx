/**
 * src/features/settings/SettingsPanel.tsx — the hand-drawn settings surface.
 *
 * A paper sheet that slides in from the right (GSAP, transform/opacity only,
 * durations scaled by --motion-scale). Every control reads the reactive
 * settings store and writes through `save()`, which persists and re-fires the
 * subscription that calls `applySettings` — so changes apply instantly.
 *
 * Keyboard: Escape closes; focus is trapped inside the sheet while open and
 * restored to the opener on close.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { gsap } from 'gsap';
import {
  bindingActionLabel,
  bindingFromEvent,
  bindingRefusal,
  canonicalBinding,
  fixedBindingReason,
  listedBindingGroups,
  rebind,
  resetBinding,
  save,
  settings,
} from '../../data/settings';
import { DEFAULT_KEYBINDINGS } from '../../data/defaults';
import { ariaKeyshortcuts, formatBinding } from '../../data/keybindings';
import { isTauri } from '../../data/db';
import { tween } from '../../styles/motion';
import type { Settings } from '../../data/types';
import {
  formatRelativeTime,
  getLastBackupRun,
  runBackupNow,
} from '../system/backup';
import { exportDiagnostics } from '../system/diagnostics';
import {
  FAMILY_NAMES,
  SOUNDSCAPE_BLURBS,
  SOUNDSCAPE_NAMES,
  play,
  type FamilyName,
} from '../../sound/engine';
import SoundCredits from '../../sound/SoundCredits';
import {
  SOUND_SETS,
  SOUND_SET_GROUPS,
  SOUND_SET_GROUP_IDS,
  SOUND_SET_IDS,
  SOUND_SET_SHORTLIST,
  soundSetSpec,
  soundSetsInGroup,
  type SoundSetGroupId,
  type SoundSetId,
} from '../../sound/soundSets';
import {
  MAX_USER_SOUND_SETS,
  isUserSoundSetId,
  userCueCount,
  userSoundSet,
  userSoundSets,
  type UserSoundSet,
} from '../../sound/userSoundSets';
import {
  ROLE_LABELS,
  addUserSoundSet,
  assignUserCue,
  clearUserCue,
  forgetUserSoundSet,
  importIntoUserSoundSet,
  loadUserSoundSets,
  roleVocabulary,
  setUserSoundSetBase,
  type ImportReport,
} from '../../sound/userSoundSetStore';
import CursorSetPicker from './CursorSetPicker';
import { notify } from '../../editor/script/exporters/toast';
import {
  activeSoundSetId,
  loadSoundSet,
  saveSoundSet,
} from '../../sound/soundSetPrefs';
import { cancelSoundSetPreview, previewSoundSet } from '../../sound/preview';
import { SILENT_ATTR } from '../../sound/uiClicks';
import {
  APP_THEMES,
  APP_THEME_FAMILIES,
  AUTO_PAPER,
  FAMILY_LABELS as THEME_FAMILY_LABELS,
  HANDS,
  HAND_FAMILIES,
  HAND_FAMILY_LABELS,
  HAND_ROLL,
  HAND_SHORTLIST,
  INKS,
  INK_FAMILIES,
  INK_ROLL,
  INK_SHORTLIST,
  PAPERS,
  PAPER_FAMILIES,
  PAPER_ROLL,
  PAPER_SHORTLIST,
  THEME_ROLL,
  THEME_SHORTLIST,
  resolveHand,
  resolveInk,
  resolvePaper,
  resolveTheme,
  swatchFor,
  type AppThemeSpec,
  type HandSpec,
  type InkSpec,
  type PaperSpec,
} from './appearance';
import { loadPaperStock, paperStock, savePaperStock } from './appearancePrefs';
import { openTransferPanel } from '../transfer';
import { replayTutorial } from '../tutorial';
import { ensureTasteMounted } from '../tutorial/tasteMount';
import { replayTaste } from '../tutorial/tasteStore';
import PerfHud from '../system/PerfHud';

/* ------------------------------- helpers ---------------------------------- */

/** Fire-and-forget save (controls apply instantly via the subscription). */
function put(patch: Partial<Settings>): void {
  void save(patch);
}

/** The stored combo for an action, falling back to the shipped default. */
function binding(action: string): string {
  return settings.keybindings[action] ?? DEFAULT_KEYBINDINGS[action] ?? '';
}

const VOLUME_KEYS = [
  'soundMaster',
  'soundUi',
  'soundPages',
  'soundShelf',
  'soundAmbient',
] as const;
type VolumeSettingKey = (typeof VOLUME_KEYS)[number];

const VOLUME_LABELS: Record<VolumeSettingKey, string> = {
  soundMaster: 'master volume',
  soundUi: 'little clicks & pops',
  soundPages: 'page sounds',
  soundShelf: 'bookshelf sounds',
  soundAmbient: 'ambient bed',
};

/**
 * The soundscape chips come from the engine's own list, so adding a bed to
 * `SOUNDSCAPE_LOOPS` puts it in the sheet without a second edit here. `.nbs-seg`
 * already wraps, which is what lets ten beds plus "none" sit in one wide row.
 *
 * The chips carry an explicit `aria-label` because `night` is also a theme:
 * two buttons announcing the same single word in one dialog is ambiguous. The
 * blurb becomes the tooltip, so a bed's character is readable before you
 * commit to hearing it.
 */
const SOUNDSCAPE_OPTIONS: readonly {
  value: string;
  label: string;
  ariaLabel: string;
  title: string;
}[] = SOUNDSCAPE_NAMES.map((name) => ({
  value: name,
  label: name,
  ariaLabel: `${name} soundscape`,
  title: SOUNDSCAPE_BLURBS[name],
}));

/* ------------------------------- sound sets -------------------------------- */

/**
 * A sound set is picked the way a binding or a room is: by name, from a list
 * with characters in it. Twenty-eight of them is too many to spread across a
 * settings sheet at rest, so the row opens on ONE set per character — the
 * shortlist the table derives from its own group order — and the reader asks
 * for the rest.
 *
 * That cap is not only tidiness. These chips are cheap (text on paper, unlike
 * the studio's drawn cards), but the panel is a focus-trapped dialog whose Tab
 * cycle walks every button in it, and twenty-eight extra stops between the
 * volume sliders and the credits is a real cost to anyone on a keyboard.
 */
interface SegOption {
  value: string;
  label: string;
  ariaLabel: string;
  title: string;
  /**
   * A little swatch tile drawn before the label — the chip showing what it
   * does rather than only naming it. Any CSS `background`, because a theme's
   * tile is TWO flat faces (its paper beside its accent) inside one ink
   * outline: the drawing's own way of saying two colours, and a hard-stop
   * gradient is how CSS states a face boundary. No soft ramp, no light model.
   */
  swatch?: string;
  /**
   * Set the label in this face. A hand is the one thing on this sheet that
   * cannot be described, only shown, so its chip is written in itself.
   */
  face?: string;
  /** px, when the face may not be set at the chip's own 13. */
  faceSize?: number;
}

/**
 * One chip descriptor per set, built ONCE.
 *
 * Identity matters here, not just allocation count. `Seg` renders its options
 * through `<For>`, which reuses a row's DOM only while the item reference is
 * unchanged — so building fresh objects on every read would tear down and
 * rebuild all 28 chips each time the selection moved, taking the focus ring
 * off the chip that was just pressed with it. Anyone picking a set from the
 * keyboard would be dropped back to the top of the dialog on every press.
 */
const SOUND_SET_OPTION: Record<SoundSetId, SegOption> = Object.fromEntries(
  SOUND_SET_IDS.map((id) => [
    id,
    {
      value: id,
      label: SOUND_SETS[id].name,
      // Several set names are ordinary words that appear elsewhere in this same
      // dialog ("House", "Paper Only"), so each chip says what kind of thing it is.
      ariaLabel: `${SOUND_SETS[id].name} sound set`,
      title: SOUND_SETS[id].blurb,
    },
  ]),
) as Record<SoundSetId, SegOption>;

const soundSetOption = (id: SoundSetId): SegOption => SOUND_SET_OPTION[id];

/** Per-character chip rows, also built once — these never change. */
const SOUND_SET_GROUP_OPTIONS = Object.fromEntries(
  SOUND_SET_GROUP_IDS.map((group) => [group, soundSetsInGroup(group).map(soundSetOption)]),
) as unknown as Record<SoundSetGroupId, readonly SegOption[]>;

/* ------------------------------- appearance -------------------------------- */

/**
 * The Appearance section's four pickers, built from `./appearance.ts`.
 *
 * This section used to be four literal arrays in the JSX below — four themes,
 * three hands, three inks — and the reader counted them: *"in appearance i
 * noticed only 4 themes… same bug for handwriting… same issue for ink, paper
 * type"*. They were right about the cause too: the vocabularies existed (fifty
 * named inks and fifty named papers in `editor/effects/vocabulary.ts`, nine
 * type families loaded in `src/index.tsx`) and the picker was reading none of
 * them. Everything below is DERIVED from the vocabulary, so the two can no
 * longer be different sizes.
 *
 * The chips are built ONCE, for the reason the sound-set chips are: `<For>`
 * reuses a row's DOM only while the item reference is unchanged, so rebuilding
 * the options on every read would tear down and rebuild every chip each time
 * the selection moved — taking the focus ring off the chip that was just
 * pressed with it, on a keyboard, inside a focus trap.
 */
const themeOption = (spec: AppThemeSpec): SegOption => {
  const swatch = swatchFor(spec.id, 'sepia', null);
  return {
    value: spec.id,
    label: spec.label,
    // "night" is a theme, a soundscape AND a bed in this one dialog.
    ariaLabel: `${spec.label} theme`,
    title: spec.blurb,
    // Its paper, and its accent standing beside it — the two things the room
    // actually decides.
    swatch: `linear-gradient(101deg, ${swatch.paper} 0 60%, ${swatch.accent} 60% 100%)`,
  };
};

const inkOption = (spec: InkSpec): SegOption => ({
  value: spec.id,
  label: spec.label,
  ariaLabel: `${spec.label} ink`,
  title: spec.blurb,
  swatch: spec.pigment,
});

const paperOption = (spec: PaperSpec): SegOption => ({
  value: spec.id,
  label: spec.label,
  ariaLabel: `${spec.label} paper`,
  title: spec.blurb,
  swatch: spec.ground,
});

const handOption = (spec: HandSpec): SegOption => ({
  value: spec.id,
  label: spec.label,
  ariaLabel: `${spec.label}, ${spec.id}`,
  // The face's real name belongs in the tooltip: the label says what the hand
  // is FOR, and a reader looking for Georgia still has to be able to find it.
  title: `${spec.id} — ${spec.blurb}`,
  face: spec.stack,
  ...(spec.floorPx === undefined ? {} : { faceSize: spec.floorPx }),
});

/** The chip for "leave the paper to the room", first in the paper row. */
const AUTO_PAPER_OPTION: SegOption = {
  value: AUTO_PAPER,
  label: 'as the room',
  ariaLabel: 'paper as the room',
  title: 'whatever the theme is printed on',
};

const THEME_OPTIONS = new Map(APP_THEMES.map((s) => [s.id, themeOption(s)] as const));
const HAND_OPTIONS = new Map(HANDS.map((s) => [s.id, handOption(s)] as const));

/**
 * Ink and paper chips are built per ROOM, not once.
 *
 * A pigment's authored hex is its hue, not the colour a page gets: on a dark
 * theme the same burgundy is derived light so it can be read. A chip painted
 * with the authored hex would therefore show a near-black tile for an ink the
 * page draws in pink — the chip lying about the one thing it exists to show.
 *
 * Rebuilt on a theme or paper change and on nothing else, so `<For>` still
 * reuses every chip's DOM while the reader is picking an INK, which is when
 * the focus ring matters.
 */
function inkOptionsFor(themeId: string, paperId: string): ReadonlyMap<string, SegOption> {
  return new Map(
    INKS.map(
      (spec) =>
        [spec.id, { ...inkOption(spec), swatch: swatchFor(themeId, spec.id, paperId).ink }] as const,
    ),
  );
}

function paperOptionsFor(themeId: string): ReadonlyMap<string, SegOption> {
  return new Map<string, SegOption>([
    [
      AUTO_PAPER,
      { ...AUTO_PAPER_OPTION, swatch: swatchFor(themeId, 'sepia', null).paper },
    ],
    ...PAPERS.map(
      (spec) =>
        [
          spec.id,
          { ...paperOption(spec), swatch: swatchFor(themeId, 'sepia', spec.id).paper },
        ] as const,
    ),
  ]);
}

/**
 * Is this face actually on this machine?
 *
 * Nine of the hands ship with the app and are always there. The rest are
 * Windows' own, and a chip for a face this machine does not have would draw
 * itself in the next thing down its fallback chain — two chips painting the
 * same letters, one of them lying about which face it is. `document.fonts.check`
 * answers for an installed local family without loading anything.
 */
function handAvailable(spec: HandSpec): boolean {
  if (spec.probe === undefined) return true;
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (fonts === undefined || typeof fonts.check !== 'function') return false;
  try {
    return fonts.check(`16px "${spec.probe}"`);
  } catch {
    return false;
  }
}

/** One shelf of chips: a heading, a line about it, and the options under it. */
interface ChipGroup {
  readonly title: string;
  readonly blurb: string;
  readonly options: readonly SegOption[];
}

function groupsOf<T extends { family: string; id: string }>(
  table: readonly T[],
  families: readonly string[],
  labels: Readonly<Record<string, string>>,
  blurbs: Readonly<Record<string, string>>,
  options: ReadonlyMap<string, SegOption>,
): readonly ChipGroup[] {
  return families
    .map((family) => ({
      title: labels[family] ?? family,
      blurb: blurbs[family] ?? '',
      options: table
        .filter((entry) => entry.family === family)
        .map((entry) => options.get(entry.id))
        .filter((opt): opt is SegOption => opt !== undefined),
    }))
    .filter((group) => group.options.length > 0);
}

const INK_FAMILY_LABELS: Readonly<Record<string, string>> = {
  neutral: 'the plain inks',
  warm: 'warm inks',
  red: 'reds',
  green: 'greens',
  blue: 'blues',
  purple: 'purples',
};

const PAPER_FAMILY_LABELS: Readonly<Record<string, string>> = {
  plain: 'plain stock',
  made: 'made paper',
  coloured: 'coloured stock',
  technical: 'technical paper',
};

const THEME_FAMILY_BLURBS: Readonly<Record<string, string>> = {
  parchment: 'cream grounds, warm accents',
  blossom: 'pale grounds, gentle accents',
  garden: 'pressed-leaf grounds',
  lamplight: 'the same drawing, after dark',
};

const INK_FAMILY_BLURBS: Readonly<Record<string, string>> = {
  neutral: 'what most pages are written in',
  warm: 'browns, earths and metals',
  red: 'from rose madder to oxblood',
  green: 'woodland, field and moss',
  blue: 'sea, sky and cold water',
  purple: 'evening colours',
};

const PAPER_FAMILY_BLURBS: Readonly<Record<string, string>> = {
  plain: 'the stock a stationer sells by the ream',
  made: 'sheets with a history',
  coloured: 'paper that is not trying to be white',
  technical: 'drawing-office stock',
};

const HAND_FAMILY_BLURBS: Readonly<Record<string, string>> = {
  bundled: 'drawn hands, shipped with the app',
  printed: 'faces for pages you sit and read',
  system: 'faces Windows already gave you',
};

const THEME_GROUPS = groupsOf(
  APP_THEMES,
  APP_THEME_FAMILIES,
  THEME_FAMILY_LABELS,
  THEME_FAMILY_BLURBS,
  THEME_OPTIONS,
);

/** One item out of a pool, for "surprise me". */
function pick<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)] as T;
}

/* --------------------------- the reader's own sets -------------------------- */

/**
 * The naming rule the bulk import follows, written out where the button is.
 *
 * It is generated from `roleVocabulary` rather than typed out, because a
 * naming rule the panel teaches and the matcher does not enforce is worse
 * than no rule at all — and the two would drift the first time a word was
 * added on one side.
 */
const CUE_NAMING_HINT = FAMILY_NAMES.map((role) => `${role} — ${ROLE_LABELS[role]}`).join('\n');

/** Every alias a file name may use for a role, for that role's own row. */
const roleWords = (role: FamilyName): string => roleVocabulary(role).join(', ');

/** One line summarising what an import actually did. */
function describeImport(report: ImportReport): string {
  const parts: string[] = [];
  if (report.assigned.length > 0) {
    const n = report.assigned.length;
    parts.push(n === 1 ? '1 cue is yours now' : `${n} cues are yours now`);
  }
  if (report.unmatched.length > 0) {
    const shown = report.unmatched.slice(0, 3).join(', ');
    parts.push(
      `could not tell what ${shown}${report.unmatched.length > 3 ? '…' : ''} should be — place them below`,
    );
  }
  if (report.rejected.length > 0) {
    parts.push(`${report.rejected.length} could not be read`);
  }
  return parts.length === 0 ? 'nothing to import' : parts.join('; ');
}

const AUTOSAVE_OPTIONS = [
  { value: 500, label: '0.5s' },
  { value: 1000, label: '1s' },
  { value: 3000, label: '3s' },
] as const;

const BACKUP_OPTIONS = [
  { value: 1, label: 'daily' },
  { value: 7, label: 'weekly' },
  { value: 30, label: 'monthly' },
] as const;

/** Which option chip is active for a stored numeric value (closest wins). */
function closestOption(
  options: readonly { value: number; label: string }[],
  value: number,
): number {
  let best = options[0]?.value ?? value;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const opt of options) {
    const dist = Math.abs(opt.value - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = opt.value;
    }
  }
  return best;
}

/* ---------------------------- small controls ------------------------------- */

/**
 * `keys` is a '+'-joined combo ("Ctrl+Shift+E") drawn as kbd chips beside the
 * hint. Rows that ALSO have a keyboard path advertise it here, so learning the
 * shortcut is a side effect of using the button once.
 */
function Row(props: {
  label: string;
  hint?: string;
  keys?: string;
  wide?: boolean;
  /**
   * Stop the control column giving up its width to the text.
   *
   * `.nbs-row-control` shrinks by default, and a `white-space: nowrap` chip
   * inside a shrunk control does NOT shrink with it — it spills past the
   * sheet's padding and gets clipped. Every action row in this panel escaped
   * that only by having a short enough button; set this on any row whose
   * button is long and let the hint (which wraps) give up the space instead.
   */
  holdControl?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div
      class="nbs-row"
      classList={{
        'nbs-row--wide': props.wide,
        'nbs-row--hold': props.holdControl,
      }}
    >
      <div class="nbs-row-text">
        <span class="nbs-row-head">
          <span class="nbs-row-label">{props.label}</span>
          <Show when={props.keys}>
            {(combo) => (
              <span class="nbs-row-keys">
                <For each={combo().split('+')}>
                  {(part) => <kbd class="nbs-kbd">{part}</kbd>}
                </For>
              </span>
            )}
          </Show>
        </span>
        <Show when={props.hint}>
          <span class="nbs-row-hint font-ui">{props.hint}</span>
        </Show>
      </div>
      <div class="nbs-row-control">{props.children}</div>
    </div>
  );
}

/** Hand-drawn toggle switch. */
function Toggle(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      class="nbs-toggle"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="nbs-toggle-track">
        <span class="nbs-toggle-thumb" />
      </span>
    </button>
  );
}

/**
 * Range slider with pencil tick marks, a value FILL on the track, and its
 * numeric readout attached to the control.
 *
 * The readout used to be passed as the Row `hint`, which parked it under the
 * label a full row-width away from the slider it described; `display` is now
 * always supplied and rendered inside the group.
 */
function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  ticks?: number;
  display?: string;
  onInput: (value: number) => void;
}): JSX.Element {
  /** 0–100 position of the thumb, consumed by the track gradient. */
  const fill = (): number => {
    const span = props.max - props.min;
    if (span <= 0) return 0;
    const pct = ((props.value - props.min) / span) * 100;
    return Math.max(0, Math.min(100, pct));
  };

  return (
    <div class="nbs-slider-group">
      <div
        class="nbs-slider-wrap"
        style={{
          '--nbs-ticks': String(props.ticks ?? 6),
          '--nbs-fill': fill().toFixed(1),
        }}
      >
        <input
          type="range"
          class="nbs-slider"
          aria-label={props.label}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onInput={(e) => props.onInput(Number(e.currentTarget.value))}
        />
      </div>
      <Show when={props.display}>
        <span class="nbs-slider-value font-ui">{props.display}</span>
      </Show>
    </div>
  );
}

/** Segmented pick rendered as little paper chips. */
function Seg(props: {
  label: string;
  /**
   * `ariaLabel` disambiguates a chip whose visible word is used by another
   * group in the same dialog — `night` is both a theme and a soundscape, and
   * two buttons announcing "night" inside one dialog is ambiguous to a screen
   * reader before it is ambiguous to a test.
   */
  options: readonly {
    value: string | number;
    label: string;
    ariaLabel?: string;
    title?: string;
    swatch?: string;
    swatchRing?: string;
    face?: string;
    faceSize?: number;
  }[];
  value: string | number;
  onSelect: (value: string | number) => void;
}): JSX.Element {
  return (
    <div class="nbs-seg" role="group" aria-label={props.label}>
      <For each={props.options}>
        {(opt) => (
          <button
            type="button"
            class="nbs-seg-chip"
            aria-label={opt.ariaLabel}
            data-tooltip={opt.title}
            aria-pressed={props.value === opt.value}
            /* The face is set on the BUTTON rather than on a span inside it,
               so the chip's own padding grows with the letters — a wide face
               in a chip sized for Patrick Hand crops its own descenders.
               `faceSize` is the face's own legibility floor: 20px for Caveat,
               which is the number CLAUDE.md states, and 16 for the two or
               three whose lower case is markedly smaller than the rest. */
            style={
              opt.face === undefined
                ? undefined
                : {
                    'font-family': opt.face,
                    ...(opt.faceSize === undefined
                      ? {}
                      : { 'font-size': `${opt.faceSize}px` }),
                  }
            }
            onClick={() => props.onSelect(opt.value)}
          >
            {/* A little swatch tile: flat fill, ONE ink outline, corners that
                bow — the drawing's own three rules at 16 by 10. It was a round
                dot and a round dot is mostly outline at this size, so a navy
                and a forest both came out as a dark bead.

                Inline because the colour IS the data: there is no stylesheet
                rule that could know a pigment picked out of a table. */}
            <Show when={opt.swatch}>
              {(fill) => (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: '17px',
                    height: '11px',
                    'margin-right': '7px',
                    'vertical-align': '-1px',
                    'border-radius': '5px 6px 5px 7px / 6px 5px 7px 5px',
                    background: fill(),
                    border: '1.5px solid var(--ink-line)',
                  }}
                />
              )}
            </Show>
            {opt.label}
          </button>
        )}
      </For>
    </div>
  );
}

/**
 * Every section carries its own pigment. `data-accent` selects a wash family
 * in settings.css, which the section's own title rule and all of its chips,
 * toggles and buttons inherit through --sec-* — so the sheet reads as six
 * hand-tinted chapters rather than one long amber list.
 */
type SectionAccent =
  | 'blush'
  | 'moss'
  | 'violet'
  | 'turquoise'
  | 'amber'
  | 'sky'
  | 'coral'
  | 'lime';

function Section(props: {
  title: string;
  accent: SectionAccent;
  children: JSX.Element;
}): JSX.Element {
  return (
    <section class="nbs-section" data-accent={props.accent}>
      <h3 class="nbs-section-title">{props.title}</h3>
      {props.children}
    </section>
  );
}

/**
 * A vocabulary picker: a shortlist at rest, every shelf on request.
 *
 * The house rule is that a long option list caps at about twenty with an "N
 * more" control, and here it is a rule with teeth — this is a focus-trapped
 * dialog whose Tab cycle walks every button inside it, so a hundred and ten
 * chips laid out flat would put a hundred stops between the theme row and the
 * body-size slider. Expanded, the shortlist row folds away rather than sitting
 * above the full list repeating half of it: a duplicate chip is a duplicate
 * Tab stop, and the row's hint already names what is selected.
 */
function Picker(props: {
  /** Row label; also the group's accessible name. */
  label: string;
  hint: string;
  /** Chips shown while collapsed. Always contains the current value. */
  shortlist: readonly SegOption[];
  /** Every chip, shelved, shown while open. */
  groups: readonly ChipGroup[];
  total: number;
  value: string;
  open: boolean;
  /** id for aria-controls — unique per picker within the dialog. */
  region: string;
  onOpen: (open: boolean) => void;
  onSelect: (value: string) => void;
}): JSX.Element {
  return (
    <>
      <Show
        when={!props.open}
        fallback={
          <Row label={props.label} hint={props.hint}>
            <button
              type="button"
              class="nbs-action-btn"
              aria-expanded
              aria-controls={props.region}
              onClick={() => props.onOpen(false)}
            >
              show fewer
            </button>
          </Row>
        }
      >
        <Row label={props.label} hint={props.hint} wide>
          <Seg
            label={props.label}
            options={props.shortlist}
            value={props.value}
            onSelect={(v) => props.onSelect(String(v))}
          />
        </Row>
        <Show when={props.total > props.shortlist.length}>
          <Row
            label={`more ${props.label}`}
            hint={`${props.total - props.shortlist.length} more, in ${props.groups.length} shelves`}
            holdControl
          >
            <button
              type="button"
              class="nbs-action-btn"
              aria-expanded={false}
              aria-controls={props.region}
              onClick={() => props.onOpen(true)}
            >
              show all {props.total}
            </button>
          </Row>
        </Show>
      </Show>
      <Show when={props.open}>
        <div id={props.region}>
          <For each={props.groups}>
            {(group) => (
              <Row label={group.title} hint={group.blurb} wide>
                <Seg
                  label={`${props.label}: ${group.title}`}
                  options={group.options}
                  value={props.value}
                  onSelect={(v) => props.onSelect(String(v))}
                />
              </Row>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

/** Hand-drawn close cross. */
function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" class="nbs-close-icon">
      <path
        d="M 3.4 4.1 C 7.6 8.2 11.9 12.1 16.4 16.2 M 16.1 3.6 C 12.3 8 8 12 3.8 16.4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}

/**
 * Hand-drawn "put it back": a pencil loop that doesn't quite close, with the
 * arrowhead struck on separately the way a hand would. One stroke weight, one
 * ink, no fill — the same vocabulary as the close cross above.
 */
function ResetIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" class="nbs-keys-reset-icon">
      <path
        d="M 4.6 8.2 C 6.4 4.1 11.9 2.9 15.0 6.1 C 18.0 9.1 16.9 14.5 12.9 16.0 C 9.4 17.3 5.6 15.3 4.6 11.7"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M 1.9 6.4 C 3.0 7.3 3.9 8.0 4.9 8.6 M 8.0 5.4 C 6.6 6.4 5.6 7.4 4.7 8.7"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}

/* ----------------------------- autostart bits ------------------------------ */

interface AutostartPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
  isEnabled(): Promise<boolean>;
}

async function loadAutostart(): Promise<AutostartPlugin> {
  return (await import('@tauri-apps/plugin-autostart')) as AutostartPlugin;
}

/* ----------------------------- backup folder bits --------------------------- */

/** Open the OS directory picker (desktop only); null when cancelled. */
async function pickBackupFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    directory: true,
    multiple: false,
    title: 'Choose a backup folder',
  });
  return typeof picked === 'string' ? picked : null;
}

/** Last path segment for a compact display of the chosen folder. */
function folderDisplayName(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/* --------------------------------- panel ----------------------------------- */

export default function SettingsPanel(props: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  let sheetRef: HTMLDivElement | undefined;
  let scrimRef: HTMLDivElement | undefined;
  let closeRef: HTMLButtonElement | undefined;
  let lastFocused: HTMLElement | null = null;

  const inTauri = isTauri();

  // Sync the persisted flag with the OS truth once per panel lifetime.
  const [autostartProbe] = createResource(async () => {
    if (!inTauri) return null;
    try {
      const plugin = await loadAutostart();
      const enabled = await plugin.isEnabled();
      if (enabled !== settings.autostart) void save({ autostart: enabled });
      return enabled;
    } catch {
      return null;
    }
  });

  const setAutostart = async (next: boolean): Promise<void> => {
    if (!inTauri) return;
    try {
      const plugin = await loadAutostart();
      if (next) await plugin.enable();
      else await plugin.disable();
      await save({ autostart: next });
    } catch {
      // Plugin unavailable — leave the stored setting untouched.
    }
  };

  /* ------------------------------ appearance ------------------------------
     Four vocabularies, four disclosures. The paper stock is the one appearance
     choice `Settings` has no field for, so it lives in the settings feature's
     own row (./appearancePrefs.ts) — the same answer `data/designPrefs.ts`
     gave for the carpentry, and for the same reason. */
  const [allThemesOpen, setAllThemesOpen] = createSignal(false);
  const [allHandsOpen, setAllHandsOpen] = createSignal(false);
  const [allInksOpen, setAllInksOpen] = createSignal(false);
  const [allPapersOpen, setAllPapersOpen] = createSignal(false);
  void loadPaperStock();

  /**
   * A shortlist that always contains the current value.
   *
   * Collapsing a list must never hide the thing that is selected — a row whose
   * chips are all unpressed reads as "nothing is chosen", which is a lie the
   * reader then tries to fix by choosing something else.
   */
  const withCurrent = (
    shortlist: readonly SegOption[],
    current: string,
    options: ReadonlyMap<string, SegOption>,
  ): readonly SegOption[] => {
    if (shortlist.some((opt) => opt.value === current)) return shortlist;
    const extra = options.get(current);
    return extra === undefined ? shortlist : [...shortlist, extra];
  };

  /** Only the hands this machine can actually draw. */
  const hands = createMemo(() => HANDS.filter(handAvailable));
  const handGroups = createMemo(() =>
    groupsOf(
      hands(),
      HAND_FAMILIES,
      HAND_FAMILY_LABELS,
      HAND_FAMILY_BLURBS,
      HAND_OPTIONS,
    ),
  );
  const handShortlist = createMemo(() =>
    withCurrent(
      HAND_SHORTLIST.filter(handAvailable).map((spec) => HAND_OPTIONS.get(spec.id) as SegOption),
      settings.handwritingFont,
      HAND_OPTIONS,
    ),
  );

  const themeShortlist = createMemo(() =>
    withCurrent(
      THEME_SHORTLIST.map((spec) => THEME_OPTIONS.get(spec.id) as SegOption),
      settings.theme,
      THEME_OPTIONS,
    ),
  );

  // The two that are painted in the room's own colours — see `inkOptionsFor`.
  const inkOptions = createMemo(() => inkOptionsFor(settings.theme, paperStock()));
  const paperOptions = createMemo(() => paperOptionsFor(settings.theme));
  const inkGroups = createMemo(() =>
    groupsOf(INKS, INK_FAMILIES, INK_FAMILY_LABELS, INK_FAMILY_BLURBS, inkOptions()),
  );
  const paperGroups = createMemo(() =>
    groupsOf(PAPERS, PAPER_FAMILIES, PAPER_FAMILY_LABELS, PAPER_FAMILY_BLURBS, paperOptions()),
  );

  const inkShortlist = createMemo(() =>
    withCurrent(
      INK_SHORTLIST.map((spec) => inkOptions().get(spec.id) as SegOption),
      settings.inkColor,
      inkOptions(),
    ),
  );
  const paperShortlist = createMemo(() =>
    withCurrent(
      [
        paperOptions().get(AUTO_PAPER) as SegOption,
        ...PAPER_SHORTLIST.map((spec) => paperOptions().get(spec.id) as SegOption),
      ],
      paperStock(),
      paperOptions(),
    ),
  );

  /** What the four rows add up to, said in one line above them. */
  const lookHint = (): string => {
    const stock = resolvePaper(paperStock());
    return `${resolveTheme(settings.theme).label} · ${resolveInk(settings.inkColor).label} ink · ${
      stock?.label ?? 'the room’s own paper'
    } · ${resolveHand(settings.handwritingFont).label}`;
  };

  /**
   * A whole look at once, from the gated pools.
   *
   * `*_ROLL` and not the full tables: an entry ranked `oddity` stays pickable
   * and stays out of the dice. The reader's rule, in their words — *"you dont
   * have to be too cruel"* — is that odd is a reason to rank down, never to
   * delete, and never a reason to be handed one unasked.
   */
  const surpriseLook = (): void => {
    const usable = HAND_ROLL.filter(handAvailable);
    put({
      theme: pick(THEME_ROLL).id as Settings['theme'],
      inkColor: pick(INK_ROLL).id,
      handwritingFont: (usable.length > 0 ? pick(usable) : pick(HAND_ROLL)).id,
    });
    void savePaperStock(pick(PAPER_ROLL).id);
  };

  // Sound credits: collapsed by default — reference material, not a control.
  const [creditsOpen, setCreditsOpen] = createSignal(false);

  // Sound sets: the shortlist at rest, every character on request.
  const [allSetsOpen, setAllSetsOpen] = createSignal(false);
  // The reader's own sets: the cue-by-cue editor, and a latch so two file
  // dialogs can never be open at once.
  const [ownCuesOpen, setOwnCuesOpen] = createSignal(false);
  // The base picker has the same cap as the shipped row, so it needs the same
  // disclosure — see `baseOptions()`.
  const [allBasesOpen, setAllBasesOpen] = createSignal(false);
  const [importBusy, setImportBusy] = createSignal(false);
  void loadSoundSet();
  void loadUserSoundSets();

  /**
   * The chips shown while the picker is collapsed: one set per character,
   * plus the reader's own SHIPPED choice if it is not among them — collapsing
   * the list must never hide the thing that is currently selected.
   *
   * A `user:` selection is deliberately not appended here: it has a row of
   * its own below, and putting it in the shipped row too would be the same
   * duplicate-Tab-stop mistake the "show all" disclosure exists to avoid.
   */
  const shortlist = (): readonly SoundSetId[] => {
    const active = activeSoundSetId();
    if (isUserSoundSetId(active) || SOUND_SET_SHORTLIST.includes(active)) {
      return SOUND_SET_SHORTLIST;
    }
    return [...SOUND_SET_SHORTLIST, active];
  };

  /** The reader's own set, when that is what is selected. */
  const activeOwnSet = (): UserSoundSet | null => userSoundSet(activeSoundSetId());

  /** The shipped set behind the selection — its own id, or a user set's base. */
  const activeBaseId = (): SoundSetId => activeOwnSet()?.base ?? (activeSoundSetId() as SoundSetId);

  /**
   * The "sound set" row's hint, for either kind of set. A reader's own set
   * has no blurb anybody wrote, so it describes itself by what it IS: how
   * much of it is theirs and whose room the rest of it is.
   */
  const activeSetHint = (): string => {
    const own = activeOwnSet();
    if (own === null) {
      const spec = soundSetSpec(activeSoundSetId() as SoundSetId);
      return `${spec.name} — ${spec.blurb}`;
    }
    const n = userCueCount(own);
    const mine =
      n === 0 ? 'nothing of yours in it yet' : n === 1 ? '1 cue of yours' : `${n} cues of yours`;
    return `${own.name} — ${mine}; the rest is ${soundSetSpec(own.base).name}`;
  };

  /** Chips for the reader's own sets, rebuilt when the registry changes. */
  const ownSetOptions = (): readonly SegOption[] =>
    userSoundSets().map((set) => ({
      value: set.id,
      label: set.name,
      ariaLabel: `${set.name} sound set (yours)`,
      title: `${userCueCount(set)} of your own cues over ${soundSetSpec(set.base).name}`,
    }));

  /** The shipped sets offered as a base, with the current one always present. */
  const baseOptions = (): readonly SegOption[] => {
    const base = activeOwnSet()?.base;
    const ids: readonly SoundSetId[] =
      base === undefined || SOUND_SET_SHORTLIST.includes(base)
        ? SOUND_SET_SHORTLIST
        : [...SOUND_SET_SHORTLIST, base];
    return ids.map(soundSetOption);
  };

  /**
   * Apply, persist, then audition. The chips are wrapped in a `data-nb-silent`
   * container so the app-wide button click does NOT fire for them: the
   * audition's own first beat is the response, played through the set that was
   * just chosen, which is the whole point of picking a voicing by ear.
   */
  const chooseSoundSet = (id: string): void => {
    void saveSoundSet(id).then(previewSoundSet);
  };

  /**
   * "Add your own set": one file dialog, then a set named after the folder
   * the files came from, selected and auditioned. New sets are based on
   * whatever is playing now, so a reader who has just settled on *Reading
   * Room* and wants their own click keeps the room they chose.
   */
  const addOwnSet = async (): Promise<void> => {
    if (importBusy()) return;
    setImportBusy(true);
    try {
      const report = await addUserSoundSet(activeBaseId());
      if (report.set === null) return;
      await saveSoundSet(report.set.id);
      setOwnCuesOpen(true);
      notify(`“${report.set.name}” — ${describeImport(report)}`);
      previewSoundSet();
    } finally {
      setImportBusy(false);
    }
  };

  /** Fold more files into the set that is already selected. */
  const importMore = async (): Promise<void> => {
    const own = activeOwnSet();
    if (own === null || importBusy()) return;
    setImportBusy(true);
    try {
      notify(describeImport(await importIntoUserSoundSet(own.id)));
    } finally {
      setImportBusy(false);
    }
  };

  /** One file, one role — auditioned immediately so the choice is heard. */
  const chooseCue = async (role: FamilyName): Promise<void> => {
    const own = activeOwnSet();
    if (own === null || importBusy()) return;
    setImportBusy(true);
    try {
      if ((await assignUserCue(own.id, role)) !== null) void play(role);
    } finally {
      setImportBusy(false);
    }
  };

  /** Hand a role back to the base set, and play what that sounds like. */
  const dropCue = async (role: FamilyName): Promise<void> => {
    const own = activeOwnSet();
    if (own === null) return;
    await clearUserCue(own.id, role);
    void play(role);
  };

  const forgetOwnSet = async (): Promise<void> => {
    const own = activeOwnSet();
    if (own === null) return;
    await forgetUserSoundSet(own.id);
    // Land on the room it was built over rather than on the house set: that
    // is the nearest thing to what they had, minus their files.
    await saveSoundSet(own.base);
    setOwnCuesOpen(false);
    notify(`“${own.name}” forgotten — your files are still on disk`);
  };

  onCleanup(cancelSoundSetPreview);

  // Backup surface: last-run stamp + manual "back up now".
  const [lastBackup, { refetch: refetchLastBackup }] =
    createResource(getLastBackupRun);
  const [backupBusy, setBackupBusy] = createSignal(false);
  const [backupNote, setBackupNote] = createSignal<string | null>(null);

  const backupNow = async (): Promise<void> => {
    if (!inTauri || backupBusy()) return;
    setBackupBusy(true);
    setBackupNote(null);
    try {
      await runBackupNow();
      await refetchLastBackup();
    } catch {
      setBackupNote('backup failed — check the folder');
    } finally {
      setBackupBusy(false);
    }
  };

  /**
   * Open the parcel desk on a tab — the exact call Ctrl+Shift+E / Ctrl+Shift+I
   * make from App.tsx, so the button and the shortcut can never drift apart.
   *
   * The settings sheet is modal and traps Tab, so it closes first; the open is
   * deferred a microtask so that trap has been torn down before the transfer
   * panel claims focus.
   */
  const openTransfer = (tab: 'export' | 'import'): void => {
    props.onClose();
    queueMicrotask(() => openTransferPanel(tab));
  };

  /** Clear the "tour completed" marker and run it again from step one. */
  const replayTour = (): void => {
    props.onClose();
    void replayTutorial();
  };

  /**
   * Reopen the taste questionnaire on the reader's previous answers.
   *
   * The sheet closes first for the same reason `openTransfer` closes it: this
   * one is modal and traps Tab, and the questionnaire claims focus the moment
   * it mounts. Nothing is written until the reader presses "dress my library",
   * so opening this and leaving costs them nothing.
   */
  const chooseLookAgain = (): void => {
    props.onClose();
    queueMicrotask(() => {
      // A no-op when the app shell already renders `<TasteQuestionnaire />`;
      // this sheet cannot render it itself, because it unmounts the moment it
      // closes and it has to close before the panel can take focus.
      ensureTasteMounted();
      void replayTaste();
    });
  };

  // Diagnostics: a plain-text report for a bug thread. See the privacy note in
  // features/system/diagnostics.ts — no page content ever reaches the file.
  const [diagBusy, setDiagBusy] = createSignal(false);
  const [diagNote, setDiagNote] = createSignal<string | null>(null);

  const saveDiagnostics = async (): Promise<void> => {
    if (diagBusy()) return;
    setDiagBusy(true);
    setDiagNote(null);
    try {
      const outcome = await exportDiagnostics();
      if (outcome === 'saved') setDiagNote('saved — safe to share');
      else if (outcome === 'failed') setDiagNote('could not write the report');
    } finally {
      setDiagBusy(false);
    }
  };

  const chooseBackupFolder = async (): Promise<void> => {
    if (!inTauri) return;
    try {
      const picked = await pickBackupFolder();
      if (picked !== null) put({ backupFolder: picked });
    } catch {
      // Dialog unavailable — keep the current folder.
    }
  };

  /* ------------------------------- shortcuts -------------------------------
     The list was a reference for a year: it rendered the map the handlers
     match on and said "these are fixed". It is a picker now — click a row and
     the next combination you press becomes that action's, unless it would
     cost you something a page cannot do without, in which case the row says
     which and stays listening. */

  /** The action whose row is listening, or null when nothing is. */
  const [capturing, setCapturing] = createSignal<string | null>(null);
  /** The last refusal, pinned to the row that earned it. */
  const [refusal, setRefusal] = createSignal<{ action: string; why: string } | null>(null);
  let keysRef: HTMLDivElement | undefined;

  /**
   * The action ids this sheet offers, under their headings — NOT every key in
   * the map, and NOT `Object.entries`, which would hand `<For>` a fresh pair
   * array per settings write and rebuild every row (taking the focus ring off
   * the button that was just pressed with them). The inner arrays are plain
   * strings, which compare by value, so the rows survive a rebind, a volume
   * drag and every other save — and the list drops the ids no handler in the
   * app performs, because a row that captures a key and then does nothing with
   * it is a worse lie than a row that was never offered.
   *
   * Grouped rather than capped. The app's usual answer to a long list is a
   * shortlist plus "show all N", and it is the wrong answer here: those lists
   * offer ALTERNATIVES for one choice, where twenty of twenty-eight can wait
   * behind a button because picking any one of them ends the task. A shortcut
   * list is a reference — every row is a separate thing the reader might be
   * looking for, and the one they want is exactly the one a shortlist would
   * have hidden. Four headings is what makes twenty-one rows readable.
   */
  const shortcutGroups = createMemo(() => listedBindingGroups(settings.keybindings));

  const listening = (action: string): boolean => capturing() === action;

  /** Why this row cannot move, or null when it can. */
  const fixed = (action: string): string | null => fixedBindingReason(action);

  const refusalFor = (action: string): string | null => {
    const last = refusal();
    return last !== null && last.action === action ? last.why : null;
  };

  /** Is this row on something other than what the app ships? */
  const isRebound = (action: string): boolean => {
    const shipped = DEFAULT_KEYBINDINGS[action];
    return shipped !== undefined && canonicalBinding(binding(action)) !== canonicalBinding(shipped);
  };

  const startCapture = (action: string): void => {
    // A row that cannot move still answers when pressed — with the reason, in
    // the same place every other refusal appears. Pressing a control and
    // getting nothing back is the one outcome this whole surface exists to
    // avoid, so "it is fixed" gets said out loud rather than by a dead button.
    const why = fixed(action);
    if (why !== null) {
      setCapturing(null);
      setRefusal({ action, why });
      return;
    }
    setRefusal(null);
    setCapturing((now) => (now === action ? null : action));
  };

  const resetShortcut = (action: string): void => {
    setCapturing(null);
    setRefusal(null);
    void resetBinding(action).then((why) => {
      if (why !== null) setRefusal({ action, why });
    });
  };

  // A capture must not outlive the sheet: a listener still swallowing keys
  // over a closed panel is invisible and unexplainable.
  createEffect(() => {
    if (props.open) return;
    setCapturing(null);
    setRefusal(null);
  });

  // While a row listens, it takes the keyboard.
  createEffect(() => {
    const action = capturing();
    if (action === null) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const combo = bindingFromEvent(event);
      if (combo === null) return; // still reaching for the rest of the combo
      if (combo === 'escape') {
        // The documented way out. Escape cannot BE a binding either (see
        // bindingRefusal), so there is no ambiguity about which it meant.
        setCapturing(null);
        setRefusal(null);
        return;
      }
      const why = bindingRefusal(action, combo, settings.keybindings);
      if (why !== null) {
        // Keep listening: the reader's next press is almost certainly another
        // try at the same row, and dropping them out of capture to say no
        // would make them click the row again to say it twice.
        setRefusal({ action, why });
        return;
      }
      setCapturing(null);
      setRefusal(null);
      void rebind(action, combo);
    };

    // Capture phase on `window`, and the event stops there: this sheet closes
    // on Escape, App.tsx exports on Ctrl+Shift+E, BookView inserts script on
    // Ctrl+Alt+I, and the editor takes nearly every letter. While a row is
    // listening, NONE of that may happen — the press is a value being typed
    // in, not a command.
    //
    // One listener does get there first and cannot be stopped from here:
    // QuickSwitcher registers its own window-capture handler at mount, so the
    // command-palette combo still opens the palette. It is harmless (that
    // combo is by definition already taken, so this refuses it anyway) but it
    // is untidy; the fix is a guard in QuickSwitcher, not a hack here.
    window.addEventListener('keydown', onKeyDown, true);

    // Clicking anywhere outside the shortcut list means the reader moved on.
    // Not preventDefault: the click they meant still lands.
    const onPointerDown = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && keysRef?.contains(target) === true) return;
      setCapturing(null);
    };
    window.addEventListener('pointerdown', onPointerDown, true);

    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    });
  });

  onMount(() => {
    if (sheetRef) gsap.set(sheetRef, { xPercent: 105, visibility: 'hidden' });
    if (scrimRef) gsap.set(scrimRef, { autoAlpha: 0 });
  });

  // Slide the paper sheet in/out whenever `open` flips.
  createEffect<boolean | undefined>((wasOpen) => {
    const open = props.open;
    const sheet = sheetRef;
    const scrim = scrimRef;
    if (!sheet || !scrim || open === wasOpen) return open;
    // A whole surface entering/leaving: the 'slow'/'normal' pair the rail
    // sheet uses, so the two panels arrive at the same tempo. tween() folds in
    // the motion preference, so there is no branch here for reduced motion.
    gsap.killTweensOf([sheet, scrim]);
    if (open) {
      lastFocused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      gsap.set(sheet, { visibility: 'visible' });
      gsap.to(sheet, { xPercent: 0, ...tween('slow', 'enter') });
      gsap.to(scrim, { autoAlpha: 1, ...tween('normal', 'enter') });
      queueMicrotask(() => closeRef?.focus());
    } else if (wasOpen !== undefined) {
      gsap.to(sheet, {
        xPercent: 105,
        ...tween('normal', 'exit'),
        onComplete: () => gsap.set(sheet, { visibility: 'hidden' }),
      });
      gsap.to(scrim, { autoAlpha: 0, ...tween('quick', 'exit') });
      lastFocused?.focus();
      lastFocused = null;
    }
    return open;
  }, undefined);

  // Escape closes; Tab is trapped inside the sheet while open.
  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      // A listening shortcut row owns the keyboard, and its own handler stops
      // the event before this one ever sees it. This is the second lock on the
      // same door: Escape must cancel the capture, never shut the sheet the
      // reader is in the middle of editing.
      if (capturing() !== null) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
        return;
      }
      if (e.key !== 'Tab' || !sheetRef) return;
      const focusables = Array.from(
        sheetRef.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0] as HTMLElement;
      const last = focusables[focusables.length - 1] as HTMLElement;
      const active = document.activeElement;
      const inside = active instanceof Node && sheetRef.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  return (
    <div class="nbs-layer">
      {/* Perf HUD lives in this always-mounted layer (gated by its setting),
          so it needs no extra App.tsx wiring. */}
      <PerfHud />
      <div
        class="nbs-scrim"
        ref={scrimRef}
        onClick={() => props.onClose()}
        aria-hidden="true"
      />
      <div
        class="nbs-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <header class="nbs-header">
          <h2 class="nbs-title">Settings</h2>
          <span class="nbs-doodle" aria-hidden="true">
            ✼
          </span>
          <button
            type="button"
            class="nbs-close"
            aria-label="Close settings"
            ref={closeRef}
            onClick={() => props.onClose()}
          >
            <CloseIcon />
          </button>
        </header>

        {/* ------------------------------ Appearance -------------------------- */}
        <Section title="Appearance" accent="blush">
          {/*
            The four questions the tour opens with, offered again.

            It sits at the TOP of Appearance rather than beside "replay the
            tour" in Help because of what it writes: the room, the case, the
            wall, the welcome book's binding, the sound set and the two rows
            immediately below it. That is this section's whole subject, and a
            reader who does not like the look they are in is going to look here
            first. It replaces nothing — every one of those choices still has
            its own control, and this is only the fast way to move all of them
            at once.
          */}
          <Row
            label="choose my look again"
            hint="four questions, and the whole library takes after your answers"
          >
            <button type="button" class="nbs-action-btn" onClick={chooseLookAgain}>
              start
            </button>
          </Row>
          {/* The whole look, in one line, above the four rows that make it —
              so the section can be read before it is operated. */}
          <Row label="surprise me" hint={lookHint()} holdControl>
            <button type="button" class="nbs-action-btn" onClick={surpriseLook}>
              roll a whole look
            </button>
          </Row>
          <Picker
            label="theme"
            hint="the room this app is drawn in"
            shortlist={themeShortlist()}
            groups={THEME_GROUPS}
            total={APP_THEMES.length}
            value={settings.theme}
            open={allThemesOpen()}
            region="nbs-themes"
            onOpen={setAllThemesOpen}
            onSelect={(v) => put({ theme: v as Settings['theme'] })}
          />
          <Picker
            label="hand"
            hint="the face every page is written in"
            shortlist={handShortlist()}
            groups={handGroups()}
            total={hands().length}
            value={settings.handwritingFont}
            open={allHandsOpen()}
            region="nbs-hands"
            onOpen={setAllHandsOpen}
            onSelect={(v) => put({ handwritingFont: v })}
          />
          <Row label="body size" hint="reading type on every page">
            <Slider
              label="body font size"
              min={15}
              max={21}
              step={1}
              ticks={6}
              display={`${settings.bodyFontSize}px`}
              value={settings.bodyFontSize}
              onInput={(v) => put({ bodyFontSize: v })}
            />
          </Row>
          <Picker
            label="ink"
            hint="what the reading type is written with"
            shortlist={inkShortlist()}
            groups={inkGroups()}
            total={INKS.length}
            value={settings.inkColor}
            open={allInksOpen()}
            region="nbs-inks"
            onOpen={setAllInksOpen}
            onSelect={(v) => put({ inkColor: v })}
          />
          <Picker
            label="paper"
            hint="the stock every page is printed on"
            shortlist={paperShortlist()}
            groups={paperGroups()}
            total={PAPERS.length + 1}
            value={paperStock()}
            open={allPapersOpen()}
            region="nbs-papers"
            onOpen={setAllPapersOpen}
            onSelect={(v) => void savePaperStock(v)}
          />
          {/* The RULING, which is a different question from the stock above:
              four of them, because four is what the editor draws
              (`.nb-page[data-style]` in styles/editor.css) and a fifth chip
              here would write a document attribute nothing knows how to
              paint. Growing this one is an editor job, not a settings job. */}
          <Row label="new pages are ruled" wide>
            <Seg
              label="default page ruling"
              options={[
                { value: 'ruled', label: 'ruled' },
                { value: 'grid', label: 'grid' },
                { value: 'blank', label: 'blank' },
                { value: 'dotted', label: 'dotted' },
              ]}
              value={settings.pageStyleDefault}
              onSelect={(v) =>
                put({ pageStyleDefault: v as Settings['pageStyleDefault'] })
              }
            />
          </Row>
          <Row label="margin doodles" hint="little sketches in the margins">
            <Toggle
              label="show margin doodles"
              checked={settings.showMarginDoodles}
              onChange={(v) => put({ showMarginDoodles: v })}
            />
          </Row>
          {/* The pointer itself. Drawn cards rather than word chips — see
              ./CursorSetPicker.tsx for why, and `art/cursors.ts` for the art.
              This is NOT the "editor cursor" row down in Writing: that one is
              the nib you write with inside a page, this is the arrow you point
              at the whole app with, and the two are deliberately separate. */}
          <Row
            label="cursors"
            hint="the pointer, drawn — or the one Windows gives you"
            wide
          >
            <CursorSetPicker
              value={settings.cursorSet}
              onSelect={(v) => put({ cursorSet: v })}
            />
          </Row>
        </Section>

        {/* --------------------------- Library & shelf ------------------------ */}
        <Section title="Library & shelf" accent="moss">
          {/* The wood stain and the wallpaper pattern used to live here, as a
              four-way each, and neither had reached the screen since the case
              went flat — a segmented control that writes a setting nothing
              reads is worse than no control. Both are real now, with far more
              in them (12 builds x 12 timber patterns, 19 papers x 4 axes), and
              both belong to the BOOKCASE rather than to the app: they are in
              the library studio on the shelf's left rail. */}
          <Row label="mouse wheel" hint="what a plain wheel spin does" wide>
            <Seg
              label="wheel mode"
              options={[
                { value: 'zoom', label: 'zooms' },
                { value: 'scroll', label: 'scrolls floors' },
              ]}
              value={settings.wheelMode}
              onSelect={(v) => put({ wheelMode: v as Settings['wheelMode'] })}
            />
          </Row>
          <Row label="sort books" wide>
            <Seg
              label="shelf sort"
              options={[
                { value: 'manual', label: 'my order' },
                { value: 'recent', label: 'recent first' },
                { value: 'favorites', label: 'favorites first' },
              ]}
              value={settings.shelfSort}
              onSelect={(v) => put({ shelfSort: v as Settings['shelfSort'] })}
            />
          </Row>
        </Section>

        {/* ----------------------------- Motion & feel ------------------------ */}
        <Section title="Motion & feel" accent="violet">
          <Row label="animation" wide>
            <Seg
              label="animation level"
              options={[
                { value: 'full', label: 'full' },
                { value: 'reduced', label: 'reduced' },
                { value: 'off', label: 'off' },
              ]}
              value={settings.animationLevel}
              onSelect={(v) =>
                put({ animationLevel: v as Settings['animationLevel'] })
              }
            />
          </Row>
          <Row label="zoom speed" hint="how fast the wheel travels">
            <Slider
              label="zoom sensitivity"
              min={0.5}
              max={2}
              step={0.05}
              ticks={6}
              display={`${settings.zoomSensitivity.toFixed(2)}×`}
              value={settings.zoomSensitivity}
              onInput={(v) => put({ zoomSensitivity: v })}
            />
          </Row>
          <Row label="drag momentum" hint="flicks keep gliding">
            <Toggle
              label="drag momentum"
              checked={settings.dragMomentum > 0}
              onChange={(v) => put({ dragMomentum: v ? 0.92 : 0 })}
            />
          </Row>
          <Row label="confetti" hint="when a task list completes">
            <Toggle
              label="confetti on complete"
              checked={settings.confettiOnComplete}
              onChange={(v) => put({ confettiOnComplete: v })}
            />
          </Row>
          <Row label="minimalist mode" hint="hide all the decorations">
            <Toggle
              label="minimalist mode"
              checked={settings.minimalistMode}
              onChange={(v) => put({ minimalistMode: v })}
            />
          </Row>
        </Section>

        {/* -------------------------------- Sound ----------------------------- */}
        <Section title="Sound" accent="turquoise">
          {/* The headline choice, above the sliders: the sliders set how loud
              the app is, the set decides what it sounds like. Every cue is the
              same licensed recording either way — a set conditions them
              (substitutes, re-pitches, trims, layers), it never adds audio. */}
          {/* Collapsed: the shortlist, one set per character. Expanded: the
              shortlist row folds away entirely rather than sitting above the
              full list repeating seven of its chips — a duplicate chip is a
              duplicate Tab stop inside a focus-trapped dialog, and the row's
              hint already names what is selected. */}
          <Show
            when={!allSetsOpen()}
            fallback={
              <Row
                label="sound set"
                hint={activeSetHint()}
              >
                <button
                  type="button"
                  class="nbs-action-btn"
                  aria-expanded
                  aria-controls="nbs-sound-sets"
                  onClick={() => setAllSetsOpen(false)}
                >
                  show fewer
                </button>
              </Row>
            }
          >
            <Row label="sound set" hint={activeSetHint()} wide>
              <div style={{ display: 'contents' }} {...{ [SILENT_ATTR]: '' }}>
                <Seg
                  label="sound set"
                  options={shortlist().map(soundSetOption)}
                  value={activeSoundSetId()}
                  onSelect={(v) => chooseSoundSet(String(v))}
                />
              </div>
            </Row>
            <Row
              label="more sound sets"
              hint={`${SOUND_SET_IDS.length - shortlist().length} more, in ${SOUND_SET_GROUP_IDS.length} characters`}
            >
              <button
                type="button"
                class="nbs-action-btn"
                aria-expanded={false}
                aria-controls="nbs-sound-sets"
                onClick={() => setAllSetsOpen(true)}
              >
                show all {SOUND_SET_IDS.length}
              </button>
            </Row>
          </Show>
          <Show when={allSetsOpen()}>
            <div id="nbs-sound-sets">
              <For each={SOUND_SET_GROUP_IDS}>
                {(group: SoundSetGroupId) => (
                  <Row
                    label={SOUND_SET_GROUPS[group].name.toLowerCase()}
                    hint={SOUND_SET_GROUPS[group].blurb}
                    wide
                  >
                    <div style={{ display: 'contents' }} {...{ [SILENT_ATTR]: '' }}>
                      <Seg
                        label={`${SOUND_SET_GROUPS[group].name} sound sets`}
                        options={SOUND_SET_GROUP_OPTIONS[group]}
                        value={activeSoundSetId()}
                        onSelect={(v) => chooseSoundSet(String(v))}
                      />
                    </div>
                  </Row>
                )}
              </For>
            </div>
          </Show>

          {/* ------------------------ the reader's own sets -------------------
              A set of theirs is a shipped BASE plus their files for some of
              the roles, so it belongs in the same picker and gets its own row
              rather than being mixed into the shipped chips — the two are
              different KINDS of thing, and one of them can be deleted. */}
          <Show when={userSoundSets().length > 0}>
            <Row
              label="your sets"
              hint={`${userSoundSets().length} of ${MAX_USER_SOUND_SETS} — your own files over a shipped room`}
              wide
            >
              <div style={{ display: 'contents' }} {...{ [SILENT_ATTR]: '' }}>
                <Seg
                  label="your own sound sets"
                  options={ownSetOptions()}
                  value={activeSoundSetId()}
                  onSelect={(v) => chooseSoundSet(String(v))}
                />
              </div>
            </Row>
          </Show>
          <Row
            label="add your own set"
            hint="your sound files — name each one after the cue it replaces, or place them by hand below"
            holdControl
          >
            <button
              type="button"
              class="nbs-action-btn"
              data-tooltip={`the cues, and what each one is:\n${CUE_NAMING_HINT}`}
              disabled={importBusy()}
              onClick={() => void addOwnSet()}
            >
              choose files…
            </button>
          </Row>

          <Show when={activeOwnSet()}>
            {(own) => (
              <>
                {/* Their files are played exactly as recorded — the app's own
                    conditioning pass is a build step over ffmpeg-decoded float,
                    not something it can do to bytes at import time. Saying so
                    where the buttons are is the only warning anyone will read. */}
                <Row
                  label="the rest of this set"
                  hint={`everything you have not filled in is voiced by ${soundSetSpec(own().base).name}`}
                  wide
                >
                  <div style={{ display: 'contents' }} {...{ [SILENT_ATTR]: '' }}>
                    <Seg
                      label="base sound set"
                      options={baseOptions()}
                      value={own().base}
                      onSelect={(v) => {
                        void setUserSoundSetBase(own().id, String(v)).then(previewSoundSet);
                      }}
                    />
                  </div>
                </Row>
                {/* The base row is capped at the same shortlist the shipped
                    row is, and it needs the same way out of the cap. Without
                    one, twenty-one of the twenty-eight rooms are reachable
                    only by selecting them as the app's set FIRST and then
                    adding a new set on top — a path nobody would find. */}
                <Show when={!allBasesOpen()}>
                  <Row
                    label="other rooms to build on"
                    hint={`${SOUND_SET_IDS.length - baseOptions().length} more, in ${SOUND_SET_GROUP_IDS.length} characters`}
                    holdControl
                  >
                    <button
                      type="button"
                      class="nbs-action-btn"
                      aria-expanded={false}
                      aria-controls="nbs-own-bases"
                      onClick={() => setAllBasesOpen(true)}
                    >
                      show all {SOUND_SET_IDS.length}
                    </button>
                  </Row>
                </Show>
                <Show when={allBasesOpen()}>
                  <div id="nbs-own-bases">
                    <For each={SOUND_SET_GROUP_IDS}>
                      {(group: SoundSetGroupId) => (
                        <Row
                          label={SOUND_SET_GROUPS[group].name.toLowerCase()}
                          hint={SOUND_SET_GROUPS[group].blurb}
                          wide
                        >
                          <div style={{ display: 'contents' }} {...{ [SILENT_ATTR]: '' }}>
                            <Seg
                              label={`${SOUND_SET_GROUPS[group].name} sets to build on`}
                              options={SOUND_SET_GROUP_OPTIONS[group]}
                              value={own().base}
                              onSelect={(v) => {
                                void setUserSoundSetBase(own().id, String(v)).then(
                                  previewSoundSet,
                                );
                              }}
                            />
                          </div>
                        </Row>
                      )}
                    </For>
                  </div>
                </Show>
                <Row
                  label="your cues"
                  hint={`${userCueCount(own())} of ${FAMILY_NAMES.length} — played as you recorded them, nothing is re-levelled`}
                  holdControl
                >
                  <button
                    type="button"
                    class="nbs-action-btn"
                    aria-expanded={ownCuesOpen()}
                    aria-controls="nbs-own-cues"
                    onClick={() => setOwnCuesOpen(!ownCuesOpen())}
                  >
                    {ownCuesOpen() ? 'hide the cues' : `place ${FAMILY_NAMES.length} cues`}
                  </button>
                </Row>
                <Show when={ownCuesOpen()}>
                  <div id="nbs-own-cues">
                    <For each={FAMILY_NAMES}>
                      {(role: FamilyName) => (
                        <Row
                          label={ROLE_LABELS[role]}
                          hint={
                            own().cues[role]?.fileName ??
                            `${soundSetSpec(own().base).name} — name a file ${roleWords(role)}`
                          }
                          holdControl
                        >
                          <div class="nbs-cue-actions">
                            <button
                              type="button"
                              class="nbs-action-btn"
                              data-tooltip={`pick a sound for ${ROLE_LABELS[role]}`}
                              disabled={importBusy()}
                              onClick={() => void chooseCue(role)}
                            >
                              {own().cues[role] === undefined ? 'choose…' : 'replace…'}
                            </button>
                            <Show when={own().cues[role] !== undefined}>
                              <button
                                type="button"
                                class="nbs-action-btn"
                                data-tooltip={`hand this back to ${soundSetSpec(own().base).name}`}
                                onClick={() => void dropCue(role)}
                              >
                                clear
                              </button>
                            </Show>
                          </div>
                        </Row>
                      )}
                    </For>
                    <Row label="more files at once" hint="fold a whole folder in by file name">
                      <button
                        type="button"
                        class="nbs-action-btn"
                        disabled={importBusy()}
                        onClick={() => void importMore()}
                      >
                        add files…
                      </button>
                    </Row>
                  </div>
                </Show>
                <Row
                  label="forget this set"
                  hint="removes the set — the sound files themselves stay where they are"
                  holdControl
                >
                  <button
                    type="button"
                    class="nbs-action-btn"
                    onClick={() => void forgetOwnSet()}
                  >
                    forget “{own().name}”
                  </button>
                </Row>
              </>
            )}
          </Show>

          <For each={VOLUME_KEYS}>
            {(key) => (
              <Row label={VOLUME_LABELS[key]}>
                <Slider
                  label={VOLUME_LABELS[key]}
                  min={0}
                  max={1}
                  step={0.05}
                  ticks={5}
                  display={`${Math.round(settings[key] * 100)}%`}
                  value={settings[key]}
                  onInput={(v) => put({ [key]: v } as Partial<Settings>)}
                />
              </Row>
            )}
          </For>
          <Row label="mute everything">
            <Toggle
              label="mute all sounds"
              checked={settings.muteAll}
              onChange={(v) => put({ muteAll: v })}
            />
          </Row>
          {/* Not "ambient bed" — that name is already taken four rows up by
              the bed's volume slider, and two controls with one label read as
              a duplicate rather than as a switch and its level. */}
          <Row label="play ambience" hint="run the chosen soundscape underneath">
            <Toggle
              label="play ambience"
              checked={settings.ambientLoop}
              onChange={(v) => put({ ambientLoop: v })}
            />
          </Row>
          <Row
            label="soundscape"
            hint={SOUNDSCAPE_BLURBS[settings.soundscape]}
            wide
          >
            <Seg
              label="soundscape"
              options={SOUNDSCAPE_OPTIONS}
              value={settings.soundscape}
              onSelect={(v) => put({ soundscape: v as Settings['soundscape'] })}
            />
          </Row>
          <Row label="typing sounds" hint="soft pencil scratches as you type">
            <Toggle
              label="typing sounds"
              checked={settings.typingSounds}
              onChange={(v) => put({ typingSounds: v })}
            />
          </Row>
          <Row label="hourly chime" hint="one soft clock note on the hour">
            <Toggle
              label="hourly chime"
              checked={settings.hourlyChime}
              onChange={(v) => put({ hourlyChime: v })}
            />
          </Row>
          <Row label="reduced sound" hint="skip hover ticks & scratches">
            <Toggle
              label="reduced sound"
              checked={settings.reducedSound}
              onChange={(v) => put({ reducedSound: v })}
            />
          </Row>
          {/* Every cue is a real recording, and one of them is CC BY — the
              licence is only satisfied if the credit reaches a person. The
              panel reads public/sounds/CREDITS.json at runtime rather than
              repeating it here, so it cannot fall out of step with the audio. */}
          <Row label="sound credits" hint="where every cue was recorded">
            <button
              type="button"
              class="nbs-action-btn"
              aria-expanded={creditsOpen()}
              onClick={() => setCreditsOpen((open) => !open)}
            >
              {creditsOpen() ? 'hide' : 'show'}
            </button>
          </Row>
          <Show when={creditsOpen()}>
            <SoundCredits />
          </Show>
        </Section>

        {/* ------------------------------- Writing ----------------------------- */}
        <Section title="Writing" accent="amber">
          <Row label="spellcheck">
            <Toggle
              label="spellcheck"
              checked={settings.spellcheck}
              onChange={(v) => put({ spellcheck: v })}
            />
          </Row>
          <Row label="autosave every" wide>
            <Seg
              label="autosave interval"
              options={AUTOSAVE_OPTIONS}
              value={closestOption(AUTOSAVE_OPTIONS, settings.autosaveIntervalMs)}
              onSelect={(v) => put({ autosaveIntervalMs: Number(v) })}
            />
          </Row>
          <Row label="editor cursor" wide>
            <Seg
              label="cursor style"
              options={[
                { value: 'standard', label: 'standard' },
                { value: 'pencil', label: 'pencil' },
                { value: 'quill', label: 'quill' },
              ]}
              value={settings.cursorStyle}
              onSelect={(v) => put({ cursorStyle: v as Settings['cursorStyle'] })}
            />
          </Row>
          <Row label="page thumbnails" hint="filmstrip of mini pages">
            <Toggle
              label="page thumbnails strip"
              checked={settings.thumbnailsStrip}
              onChange={(v) => put({ thumbnailsStrip: v })}
            />
          </Row>
        </Section>

        {/* ------------------------------- System ------------------------------ */}
        <Section title="System" accent="sky">
          <Row
            label="start with Windows"
            hint={
              inTauri
                ? 'open Alcove when you log in'
                : 'available in the desktop app'
            }
          >
            <Toggle
              label="autostart"
              checked={inTauri ? settings.autostart : false}
              disabled={!inTauri || autostartProbe.loading}
              onChange={(v) => void setAutostart(v)}
            />
          </Row>
          <Row label="backups" hint="keep copies of the library">
            <Toggle
              label="backups"
              checked={settings.backupEnabled}
              onChange={(v) => put({ backupEnabled: v })}
            />
          </Row>
          <Show when={settings.backupEnabled}>
            <Row label="back up" wide>
              <Seg
                label="backup interval"
                options={BACKUP_OPTIONS}
                value={closestOption(BACKUP_OPTIONS, settings.backupIntervalDays)}
                onSelect={(v) => put({ backupIntervalDays: Number(v) })}
              />
            </Row>
          </Show>
          <Row
            label="backup folder"
            hint={
              settings.backupFolder !== null
                ? folderDisplayName(settings.backupFolder)
                : 'app data folder'
            }
          >
            <div class="nbs-btn-pair">
              <button
                type="button"
                class="nbs-action-btn"
                disabled={!inTauri}
                data-tooltip={
                  inTauri
                    ? settings.backupFolder ?? 'app data folder'
                    : 'available in the desktop app'
                }
                onClick={() => void chooseBackupFolder()}
              >
                choose…
              </button>
              <Show when={settings.backupFolder !== null}>
                <button
                  type="button"
                  class="nbs-action-btn"
                  onClick={() => put({ backupFolder: null })}
                >
                  default
                </button>
              </Show>
            </div>
          </Row>
          <Row
            label="back up now"
            hint={
              !inTauri
                ? 'available in the desktop app'
                : backupNote() ??
                  `last backup: ${formatRelativeTime(
                    lastBackup() ?? null,
                    new Date(),
                  )}`
            }
          >
            <button
              type="button"
              class="nbs-action-btn"
              disabled={!inTauri || backupBusy()}
              onClick={() => void backupNow()}
            >
              {backupBusy() ? 'backing up…' : 'back up now'}
            </button>
          </Row>
          <Row label="open with last book" hint="jump straight back in">
            <Toggle
              label="launch into last book"
              checked={settings.launchIntoLastBook}
              onChange={(v) => put({ launchIntoLastBook: v })}
            />
          </Row>
          <Row
            label="tray quick capture"
            hint={
              inTauri
                ? 'tray icon with a quick Inbox note'
                : 'available in the desktop app'
            }
          >
            <Toggle
              label="tray quick capture"
              checked={inTauri ? settings.trayQuickCapture : false}
              disabled={!inTauri}
              onChange={(v) => put({ trayQuickCapture: v })}
            />
          </Row>
          <Row label="performance HUD" hint="fps + texture memory overlay">
            <Toggle
              label="performance HUD"
              checked={settings.perfHud}
              onChange={(v) => put({ perfHud: v })}
            />
          </Row>
          <div class="nbs-keys" ref={keysRef}>
            <span class="nbs-row-label">shortcuts</span>
            {/* Says what you can do with them, because now there is something
                to do. This line said "these are fixed — a reference, not a
                picker", and before that "rebinding is on its way", which was a
                promise with nothing behind it. */}
            <span class="nbs-row-hint font-ui">
              press a combination to change it · Escape leaves it as it was
            </span>
            <For each={shortcutGroups()}>
              {(group) => (
                <>
                  {/* The heading says WHERE, not just what: half of these only
                      do anything in one room, and a reader hunting for "the
                      catalogue" finds it faster under "In a book" than in one
                      alphabetical run of twenty-one. */}
                  <p class="nbs-keys-group font-ui">
                    <span class="nbs-keys-group-title">{group.title}</span>
                    <span class="nbs-keys-group-where">{group.blurb}</span>
                  </p>
                  <ul class="nbs-keys-list">
                    <For each={group.actions}>
                      {(action) => (
                        <li
                          class="nbs-keys-item"
                          classList={{ 'is-listening': listening(action) }}
                        >
                          <span class="nbs-keys-text">
                            <span class="nbs-keys-action">
                              {bindingActionLabel(action)}
                            </span>
                            {/* Why a press was turned down, beside the row that
                                turned it down — never a silent nothing-happened.
                                role=alert because the reader is looking at the
                                keyboard, not at this line, when it appears. */}
                            <Show when={refusalFor(action)}>
                              {(why) => (
                                <span class="nbs-keys-why font-ui" role="alert">
                                  {why()}
                                </span>
                              )}
                            </Show>
                          </span>
                          <span class="nbs-keys-controls">
                            <button
                              type="button"
                              class="nbs-keys-combo"
                              data-listening={listening(action) ? 'true' : undefined}
                              data-fixed={fixed(action) !== null ? 'true' : undefined}
                              aria-label={
                                listening(action)
                                  ? `press the new combination for ${bindingActionLabel(action)}, or Escape to leave it`
                                  : fixed(action) !== null
                                    ? `${bindingActionLabel(action)}, ${formatBinding(binding(action))} — this one cannot be changed`
                                    : `${bindingActionLabel(action)}, ${formatBinding(binding(action))} — press to change it`
                              }
                              aria-keyshortcuts={ariaKeyshortcuts(binding(action))}
                              /* NO data-tooltip, deliberately. This button carries
                                 a visible label (the action name beside it) and the
                                 line above the list already says "press a
                                 combination to change it" — Tooltip.tsx's own rule
                                 is that a bubble repeating text sitting in full
                                 underneath it is noise. It was also actively
                                 harmful here: the sheet is against the right edge,
                                 so the bubble flips left and lands on the row's own
                                 words, including the sentence saying why a key was
                                 just turned down. And it would not stay away —
                                 pressing the row re-renders it, and the fresh node
                                 fires `pointerover` under a pointer that never
                                 moved. The icon-only reset button below still has
                                 one; it has no label to read. */
                              onClick={() => startCapture(action)}
                            >
                              {/* formatBinding, not the raw combo: 'mod' is a
                                  storage token, and a chip reading "mod" is a key
                                  nobody has. */}
                              <Show
                                when={!listening(action)}
                                fallback={
                                  <span class="nbs-keys-listen">press the keys…</span>
                                }
                              >
                                <For each={formatBinding(binding(action)).split('+')}>
                                  {(part) => <kbd class="nbs-kbd">{part}</kbd>}
                                </For>
                              </Show>
                            </button>
                            {/* Only on a row that has actually moved: a column of
                                identical undo arrows, all but one of which do
                                nothing, teaches the reader to stop reading them. */}
                            <Show when={isRebound(action)}>
                              <button
                                type="button"
                                class="nbs-keys-reset"
                                aria-label={`put ${bindingActionLabel(action)} back to ${formatBinding(DEFAULT_KEYBINDINGS[action] ?? '')}`}
                                data-tooltip={`back to ${formatBinding(DEFAULT_KEYBINDINGS[action] ?? '')}`}
                                onClick={() => resetShortcut(action)}
                              >
                                <ResetIcon />
                              </button>
                            </Show>
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </>
              )}
            </For>
          </div>
        </Section>

        {/* --------------------------- Library files -------------------------- */}
        <Section title="Library files" accent="coral">
          {/* Chips are derived from the same binding the handler matches on
              (App.tsx), so a rebind cannot leave this row lying. */}
          <Row
            label="export library…"
            hint="pack books into one file you can keep or move"
            keys={formatBinding(binding('export-library'))}
          >
            <button
              type="button"
              class="nbs-action-btn"
              aria-keyshortcuts={ariaKeyshortcuts(binding('export-library'))}
              onClick={() => openTransfer('export')}
            >
              export…
            </button>
          </Row>
          <Row
            label="import library…"
            hint="add a bundle to this shelf — nothing is overwritten"
            keys={formatBinding(binding('import-library'))}
          >
            <button
              type="button"
              class="nbs-action-btn"
              aria-keyshortcuts={ariaKeyshortcuts(binding('import-library'))}
              onClick={() => openTransfer('import')}
            >
              import…
            </button>
          </Row>
          <Row
            label="export diagnostics…"
            hint={diagNote() ?? 'a plain-text report to share — no page text'}
          >
            <button
              type="button"
              class="nbs-action-btn"
              disabled={diagBusy()}
              onClick={() => void saveDiagnostics()}
            >
              {diagBusy() ? 'writing…' : 'save report…'}
            </button>
          </Row>
        </Section>

        {/* ------------------------------- Help ------------------------------- */}
        <Section title="Help" accent="lime">
          <Row label="replay the tour" hint="the guided walk around the library, again">
            <button type="button" class="nbs-action-btn" onClick={replayTour}>
              start
            </button>
          </Row>
        </Section>

        <p class="nbs-footnote font-ui">
          everything saves itself, instantly · telemetry: never
        </p>
      </div>
    </div>
  );
}
