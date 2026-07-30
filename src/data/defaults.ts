import type { Settings } from './types';

export const DEFAULT_KEYBINDINGS: Readonly<Record<string, string>> = {
  'command-palette': 'mod+k',
  'new-page': 'mod+n',
  'insert-script': 'mod+shift+i',
  'export-script': 'mod+shift+e',
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
  defaultBookPalette: 'amber',

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

  telemetry: false,
};
