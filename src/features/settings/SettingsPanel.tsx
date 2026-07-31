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
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { gsap } from 'gsap';
import { save, settings } from '../../data/settings';
import { DEFAULT_KEYBINDINGS } from '../../data/defaults';
import { ariaKeyshortcuts, formatBinding } from '../../data/keybindings';
import { isTauri } from '../../data/db';
import { tween } from '../../styles/motion';
import type { BookPalette, Settings } from '../../data/types';
import {
  formatRelativeTime,
  getLastBackupRun,
  runBackupNow,
} from '../system/backup';
import { exportDiagnostics } from '../system/diagnostics';
import { openTransferPanel } from '../transfer';
import { replayTutorial } from '../tutorial';
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

const BOOK_PALETTES: readonly BookPalette[] = [
  'amber',
  'terracotta',
  'moss',
  'lemon',
  'sky',
  'blush',
  'plum',
  'peach',
  'sage',
  'lavender',
  'sand',
  'slate',
];

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
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="nbs-row" classList={{ 'nbs-row--wide': props.wide }}>
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
  options: readonly { value: string | number; label: string }[];
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
            aria-pressed={props.value === opt.value}
            onClick={() => props.onSelect(opt.value)}
          >
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
          <Row label="theme" wide>
            <Seg
              label="theme"
              options={[
                { value: 'parchment', label: 'parchment' },
                { value: 'pastel', label: 'pastel' },
                { value: 'botanical', label: 'botanical' },
                { value: 'night', label: 'night' },
              ]}
              value={settings.theme}
              onSelect={(v) => put({ theme: v as Settings['theme'] })}
            />
          </Row>
          <Row label="handwriting" wide>
            <Seg
              label="handwriting font"
              options={[
                { value: 'Caveat', label: 'Caveat' },
                { value: 'Patrick Hand', label: 'Patrick Hand' },
                { value: 'Kalam', label: 'Kalam' },
              ]}
              value={settings.handwritingFont}
              onSelect={(v) => put({ handwritingFont: String(v) })}
            />
          </Row>
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
          <Row label="ink" wide>
            <Seg
              label="ink color"
              options={[
                { value: 'sepia', label: 'sepia' },
                { value: 'graphite', label: 'graphite' },
                { value: 'ink-blue', label: 'ink blue' },
              ]}
              value={settings.inkColor}
              onSelect={(v) => put({ inkColor: String(v) })}
            />
          </Row>
          <Row label="new pages are" wide>
            <Seg
              label="default page style"
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
          <Row label="library ambience" hint="a soft looping library hush">
            <Toggle
              label="ambient library loop"
              checked={settings.ambientLoop}
              onChange={(v) => put({ ambientLoop: v })}
            />
          </Row>
          <Row label="soundscape" wide>
            <Seg
              label="soundscape"
              options={[
                { value: 'library', label: 'library' },
                { value: 'rain', label: 'rain' },
                { value: 'fireplace', label: 'fireplace' },
                { value: 'crickets', label: 'crickets' },
                { value: 'none', label: 'none' },
              ]}
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
          <Row label="new books wear" wide>
            <div
              class="nbs-swatches"
              role="group"
              aria-label="default book palette"
            >
              <For each={BOOK_PALETTES}>
                {(palette) => (
                  <button
                    type="button"
                    class="nbs-swatch"
                    data-palette={palette}
                    aria-label={`${palette} palette`}
                    aria-pressed={settings.defaultBookPalette === palette}
                    title={palette}
                    onClick={() => put({ defaultBookPalette: palette })}
                  />
                )}
              </For>
            </div>
          </Row>
        </Section>

        {/* ------------------------------- System ------------------------------ */}
        <Section title="System" accent="sky">
          <Row
            label="start with Windows"
            hint={
              inTauri
                ? 'open Notebook when you log in'
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
                title={
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
          <div class="nbs-keys">
            <span class="nbs-row-label">shortcuts</span>
            <span class="nbs-row-hint font-ui">
              defaults for now — rebinding is on its way
            </span>
            <ul class="nbs-keys-list">
              <For
                each={Object.entries(settings.keybindings).sort(([a], [b]) =>
                  a.localeCompare(b),
                )}
              >
                {([action, combo]) => (
                  <li class="nbs-keys-item">
                    <span class="nbs-keys-action">
                      {action.replace(/-/g, ' ')}
                    </span>
                    {/* formatBinding, not the raw combo: 'mod' is a storage
                        token, and a chip reading "mod" is a key nobody has. */}
                    <span class="nbs-keys-combo">
                      <For each={formatBinding(combo).split('+')}>
                        {(part) => <kbd class="nbs-kbd">{part}</kbd>}
                      </For>
                    </span>
                  </li>
                )}
              </For>
            </ul>
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
