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
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { gsap } from 'gsap';
import { save, settings } from '../../data/settings';
import { isTauri } from '../../data/db';
import type { BookPalette, Settings } from '../../data/types';

/* ------------------------------- helpers ---------------------------------- */

/** Fire-and-forget save (controls apply instantly via the subscription). */
function put(patch: Partial<Settings>): void {
  void save(patch);
}

/** Current --motion-scale as a number (0 when motion is off). */
function motionScale(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--motion-scale')
    .trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 1;
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

function Row(props: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="nbs-row" classList={{ 'nbs-row--wide': props.wide }}>
      <div class="nbs-row-text">
        <span class="nbs-row-label">{props.label}</span>
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

/** Range slider with pencil tick marks. */
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
  return (
    <div class="nbs-slider-group">
      <div
        class="nbs-slider-wrap"
        style={{ '--nbs-ticks': String(props.ticks ?? 6) }}
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

function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="nbs-section">
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
    const dur = 0.45 * motionScale();
    gsap.killTweensOf([sheet, scrim]);
    if (open) {
      lastFocused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      gsap.set(sheet, { visibility: 'visible' });
      gsap.to(sheet, { xPercent: 0, duration: dur, ease: 'power3.out' });
      gsap.to(scrim, { autoAlpha: 1, duration: dur * 0.7, ease: 'power1.out' });
      queueMicrotask(() => closeRef?.focus());
    } else if (wasOpen !== undefined) {
      gsap.to(sheet, {
        xPercent: 105,
        duration: dur * 0.8,
        ease: 'power2.in',
        onComplete: () => gsap.set(sheet, { visibility: 'hidden' }),
      });
      gsap.to(scrim, { autoAlpha: 0, duration: dur * 0.6, ease: 'power1.in' });
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
        <Section title="Appearance">
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
          <Row label="body size" hint={`${settings.bodyFontSize}px`}>
            <Slider
              label="body font size"
              min={15}
              max={21}
              step={1}
              ticks={6}
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

        {/* ----------------------------- Motion & feel ------------------------ */}
        <Section title="Motion & feel">
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
          <Row
            label="zoom speed"
            hint={`${settings.zoomSensitivity.toFixed(2)}×`}
          >
            <Slider
              label="zoom sensitivity"
              min={0.5}
              max={2}
              step={0.05}
              ticks={6}
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
        <Section title="Sound">
          <For each={VOLUME_KEYS}>
            {(key) => (
              <Row
                label={VOLUME_LABELS[key]}
                hint={`${Math.round(settings[key] * 100)}%`}
              >
                <Slider
                  label={VOLUME_LABELS[key]}
                  min={0}
                  max={1}
                  step={0.05}
                  ticks={5}
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
          <Row label="reduced sound" hint="skip hover ticks & scratches">
            <Toggle
              label="reduced sound"
              checked={settings.reducedSound}
              onChange={(v) => put({ reducedSound: v })}
            />
          </Row>
        </Section>

        {/* ------------------------------- Writing ----------------------------- */}
        <Section title="Writing">
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
        <Section title="System">
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
                {([action, binding]) => (
                  <li class="nbs-keys-item">
                    <span class="nbs-keys-action">
                      {action.replace(/-/g, ' ')}
                    </span>
                    <span class="nbs-keys-combo">
                      <For each={binding.split('+')}>
                        {(part) => <kbd class="nbs-kbd">{part}</kbd>}
                      </For>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Section>

        <p class="nbs-footnote font-ui">
          everything saves itself, instantly · telemetry: never
        </p>
      </div>
    </div>
  );
}
