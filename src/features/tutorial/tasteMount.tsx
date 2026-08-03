/**
 * src/features/tutorial/tasteMount.tsx — put the taste questionnaire on screen
 * from a host that has not (yet) rendered it into its own tree.
 *
 * Same shape, and the same reason, as `./devMount.tsx` does for the tour: the
 * panel is a full-viewport Portal that owns its own open/closed state, so where
 * it is anchored in the tree does not matter — only that it is mounted
 * somewhere that outlives the thing that opens it.
 *
 * Two callers:
 *  - the settings sheet's "choose my look again" row, which cannot render the
 *    panel itself (the sheet unmounts the instant it closes, and it closes
 *    before the panel opens);
 *  - Playwright, over the Vite dev server.
 *
 * Idempotent and self-cancelling: if the app shell already renders
 * `<TasteQuestionnaire />` — which is the way it SHOULD be wired, see that
 * file's docblock — this returns without doing anything, so there can never be
 * two panels arguing over one signal.
 */

import { render } from 'solid-js/web';
import TasteQuestionnaire, { isTasteMounted } from './tasteQuestionnaire';

const HOST_ID = 'nbq-host';

/**
 * Make sure exactly one questionnaire exists. Returns a disposer for the one
 * this call created, or a no-op when there already was one.
 */
export function ensureTasteMounted(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (isTasteMounted() || document.getElementById(HOST_ID) !== null) {
    return () => undefined;
  }
  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);
  const dispose = render(() => <TasteQuestionnaire />, host);
  return () => {
    dispose();
    host.remove();
  };
}

export default ensureTasteMounted;
