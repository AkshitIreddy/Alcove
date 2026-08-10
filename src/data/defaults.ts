import type { Settings } from './types';

/**
 * Every combo the settings sheet advertises.
 *
 * Re-exported rather than written out: the combos are DERIVED from
 * `SHORTCUT_ACTIONS` in ./keybindings, which is also what the settings sheet
 * lists, what the cheat sheet draws and what the one keydown dispatcher
 * matches on. This literal used to be a ninth place a shortcut had to be
 * spelled correctly, and the drift it allowed is written up in that file.
 */
export { DEFAULT_KEYBINDINGS } from './keybindings';
import { DEFAULT_KEYBINDINGS as SHIPPED_KEYBINDINGS } from './keybindings';

export const DEFAULT_SETTINGS: Settings = {
  // Appearance
  // A new profile opens in the shipped Blossom room: pale paper with a vivid
  // rose accent. Settings, selected tools and primary controls therefore read
  // as deliberate pink signals instead of folding into the walnut room as moss.
  theme: 'pastel',
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
  /*
   * The room has a fire in it when you arrive.
   *
   * `soundscape` below has said 'fireplace' since the beds were built, and
   * this flag being false meant nobody ever heard it without going to look —
   * a default that names an atmosphere and then does not play it is not a
   * default, it is a preference with a nice name.
   *
   * Safe to have on: it is a BED, not a cue, mixed at 0.35 under a 0.8 master,
   * and the webview's autoplay policy holds it until the reader's first click
   * — so the app is never making noise at somebody who has not touched it yet.
   * One switch in the settings sheet turns it off, and `reducedSound` and
   * `muteAll` both still win over it.
   */
  ambientLoop: true,
  // Incidental effects are opt-in in the settings sheet. New libraries keep
  // only meaningful action feedback until a reader asks for a fuller soundscape.
  reducedSound: true,

  // Behavior
  autostart: false,
  zoomSensitivity: 1,
  dragMomentum: 0.92,
  autosaveIntervalMs: 400,
  backupEnabled: true,
  backupIntervalDays: 7,
  spellcheck: true,

  // Input
  keybindings: { ...SHIPPED_KEYBINDINGS },

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
  // The house arrow, not `system`: an app that draws its own bookcase, wall,
  // bindings and icons and then borrows the OS pointer is one borrowed thing
  // away from consistent. `system` stays one keypress away in the sheet, and
  // `cursorSkin.effectiveCursorSet` hands it back on its own under Windows
  // High Contrast, where a drawn cursor is the wrong answer.
  cursorSet: 'paper',

  // Wave 2 — books & pages
  journalBookId: null,
  thumbnailsStrip: false,

  // Wave 2 — system
  launchIntoLastBook: false,
  trayQuickCapture: false,
  closeToTray: false,
  // Keep background audio alive unless a reader explicitly asks for focus-
  // based muting. `settings.mergeStored` still honours either saved boolean,
  // so this changes only a new profile (or a blob with no value for the key).
  muteSoundsWhenUnfocused: false,
  // Hiding Alcove is different from briefly focusing another window: by
  // default the room goes quiet when it is put away in the tray. Readers who
  // want a continuous bed can opt back in from Sound.
  playAmbienceInTray: false,
  backupFolder: null,
  perfHud: false,
  // Replacing a reader's edited guide is always an explicit opt-in.
  refreshWelcomeBookOnUpdate: false,

  telemetry: false,
};
