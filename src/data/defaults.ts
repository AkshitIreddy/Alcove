import type { Settings } from './types';

/**
 * Every combo the settings sheet advertises, and the only place they are
 * chosen. Handlers read this map through `settings.keybindings` and match with
 * `data/keybindings.matchesBinding`, so a rebind here moves the real shortcut.
 *
 * The script pair sits on mod+alt rather than mod+shift because mod+shift+e /
 * mod+shift+i belong to the library export/import — the settings sheet shows
 * those two on their own rows, so they are the ones a reader will hit first.
 */
export const DEFAULT_KEYBINDINGS: Readonly<Record<string, string>> = {
  'command-palette': 'mod+k',
  'new-page': 'mod+n',
  'export-library': 'mod+shift+e',
  'import-library': 'mod+shift+i',
  'insert-script': 'mod+alt+i',
  'export-script': 'mod+alt+e',
  'toggle-handwriting': 'mod+shift+h',
  'zoom-to-shelf': 'escape',
};

export const DEFAULT_SETTINGS: Settings = {
  // Appearance
  theme: 'parchment',
  handwritingEnabled: true,
  handwritingFont: 'Patrick Hand',
  bodyFontSize: 18,
  pageStyleDefault: 'ruled',
  inkColor: 'sepia',
  animationLevel: 'full',
  minimalistMode: false,
  showMarginDoodles: true,
  confettiOnComplete: true,

  // Sound
  soundMaster: 0.8,
  soundUi: 0.7,
  soundPages: 0.8,
  soundShelf: 0.7,
  soundAmbient: 0.35,
  muteAll: false,
  ambientLoop: false,
  reducedSound: false,

  // Behavior
  autostart: false,
  zoomSensitivity: 1,
  dragMomentum: 0.92,
  autosaveIntervalMs: 400,
  backupEnabled: true,
  backupIntervalDays: 7,
  spellcheck: true,

  // Input
  keybindings: { ...DEFAULT_KEYBINDINGS },

  // Wave 2 — library & shelf
  wheelMode: 'zoom',
  shelfSort: 'manual',

  // Wave 2 — ambience & input feel
  // Fireplace, by request — the refined end of the shelf rather than the
  // obvious one. This is the constant a NEW install actually hears:
  // features/settings/apply.ts calls setSoundscape(settings.soundscape) on
  // boot, so the engine's own internal placeholder never reaches a reader and
  // changing that one instead would have moved nothing.
  soundscape: 'fireplace',
  typingSounds: false,
  hourlyChime: false,
  cursorStyle: 'standard',

  // Wave 2 — books & pages
  journalBookId: null,
  thumbnailsStrip: false,

  // Wave 2 — system
  launchIntoLastBook: false,
  trayQuickCapture: false,
  backupFolder: null,
  perfHud: false,

  telemetry: false,
};
