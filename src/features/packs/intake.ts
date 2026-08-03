/**
 * src/features/packs/intake.ts — getting the reader's file off their disk.
 *
 * Three flows, and only one of them is new:
 *
 *   MANIFEST   a .json file, read as text and handed to the validator. New.
 *   IMAGES     PNG/SVG straight into the sticker registry. This is
 *              `features/templates/userStickers.ts`, unchanged, wired through
 *              so a reader who already has drawings on disk is not made to
 *              wrap them in JSON first.
 *   AUDIO      a folder of cues into a reader's sound set. This is
 *              `sound/userSoundSetStore.ts`, unchanged.
 *
 * The brief was explicit that the two existing importers are precedent to
 * FOLD IN rather than to replace, and that is the right call for a reason
 * worth writing down: both of them put bytes through the asset store and out
 * the other side into a registry the rest of the app already reads. A third
 * copy of that would be a third place for a `user:` id to be minted slightly
 * differently. So packs own the FORMAT, the instructions and the validation,
 * and those two keep owning their bytes.
 *
 * The dialog shape below (a hidden <input type=file> in the browser, the
 * plugin dialog under Tauri, and a focus-based settle for the case where the
 * reader cancels) is deliberately identical to those two modules. It is not
 * elegant; it is what actually resolves when somebody presses Escape on a
 * native file picker, and it has been debugged once already.
 */

import { isTauri } from '../../data/db';
import { notify } from '../../editor/script/exporters/toast';
import { importUserStickers } from '../templates/userStickers';
import type { UserStickerRecord } from '../../editor/nodes/stickers';
import {
  addUserSoundSet,
  type ImportReport as SoundImportReport,
} from '../../sound/userSoundSetStore';
import { snapshotSoundSetId } from '../../sound/soundSetPrefs';
import { baseSetIdOf } from '../../sound/userSoundSets';
import { DEFAULT_SOUND_SET_ID } from '../../sound/soundSets';

/** A pack file the reader chose, before anything has judged it. */
export interface PickedPack {
  readonly fileName: string;
  readonly text: string;
}

/**
 * A ceiling on the manifest itself. Half a megabyte of JSON is thirty
 * stickers' worth of hand-drawn SVG with room to spare, and it is small
 * enough that a reader who picks the wrong file gets a sentence back rather
 * than a frozen panel.
 */
export const MAX_MANIFEST_BYTES = 512 * 1024;

const JSON_EXTENSIONS = ['json', 'txt'];

function extOf(nameOrPath: string): string | null {
  return /\.([a-z0-9]{1,5})$/i.exec(nameOrPath.trim())?.[1]?.toLowerCase() ?? null;
}

async function pickTauriManifest(): Promise<PickedPack | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: false,
    filters: [{ name: 'Alcove pack', extensions: JSON_EXTENSIONS }],
  });
  if (picked === null || Array.isArray(picked)) return null;
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(picked);
    if (bytes.byteLength > MAX_MANIFEST_BYTES) {
      notify('that file is far too big to be a pack');
      return null;
    }
    const fileName = picked.replace(/\\/g, '/').split('/').pop() ?? picked;
    return { fileName, text: new TextDecoder().decode(bytes) };
  } catch {
    notify('could not read that file');
    return null;
  }
}

function pickBrowserManifest(): Promise<PickedPack | null> {
  return new Promise((resolve) => {
    document.querySelector('input[data-nb-pack-import]')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,application/json,text/plain';
    input.multiple = false;
    input.setAttribute('data-nb-pack-import', 'true');
    input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(input);

    let settled = false;
    const finish = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      const file = input.files?.[0];
      input.remove();
      if (file === undefined) {
        resolve(null);
        return;
      }
      if (file.size > MAX_MANIFEST_BYTES) {
        notify('that file is far too big to be a pack');
        resolve(null);
        return;
      }
      try {
        resolve({ fileName: file.name, text: await file.text() });
      } catch {
        notify(`could not read ${file.name}`);
        resolve(null);
      }
    };

    input.addEventListener('change', () => void finish());
    // The reader cancelled the native picker: `change` never fires, and
    // without this the promise would never settle and the dialog's button
    // would stay disabled for the rest of the session.
    window.addEventListener('focus', () => setTimeout(() => void finish(), 1200), { once: true });
    input.click();
  });
}

/** Choose one pack file. Resolves null when the reader backs out. */
export function pickPackFile(): Promise<PickedPack | null> {
  return isTauri() ? pickTauriManifest() : pickBrowserManifest();
}

/**
 * Extension check, for the message when somebody picks their holiday photos.
 *
 * There is no `packFromText` beside this. Pasting is a first-class route — a
 * reader who has just been handed JSON in a chat window has it on the
 * clipboard — but the dialog already holds that text in a signal, so a helper
 * that wrapped it in a `{ fileName, text }` would exist only to be exported.
 * Both routes end at `validatePackText`, which is the thing worth having once.
 */
export function looksLikeManifest(fileName: string): boolean {
  const ext = extOf(fileName);
  return ext === null || JSON_EXTENSIONS.includes(ext);
}

/* ---------------------------- the folded-in two --------------------------- */

/** PNG/SVG files straight into the sticker registry. */
export function importStickerImages(): Promise<readonly UserStickerRecord[]> {
  return importUserStickers();
}

/**
 * A folder of audio into a new set of the reader's own.
 *
 * Based on whatever voicing they are listening to right now rather than on the
 * house set: every cue they do not supply keeps playing what they already
 * chose, which is the behaviour somebody who has spent time in the sound
 * settings expects, and it costs one line to be right about.
 */
export function importSoundFolder(): Promise<SoundImportReport> {
  return addUserSoundSet(baseSetIdOf(snapshotSoundSetId(), DEFAULT_SOUND_SET_ID));
}

export type { SoundImportReport };
