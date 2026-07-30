/**
 * src/features/tutorial/devMount.tsx — mount the tour into a page that has
 * not (yet) wired `<TutorialOverlay />` into its tree.
 *
 * Two uses:
 *  - Visual QA / Playwright: `import('/src/features/tutorial/devMount.tsx')`
 *    over the Vite dev server, then `mountTutorialDev()`. This is what
 *    tests/e2e/tutorial.spec.ts falls back to.
 *  - A safety net for the app shell: calling it twice is a no-op, so it can
 *    never produce two overlays alongside a real `<TutorialOverlay />` mount.
 *
 * Not imported by the app. Once App.tsx renders the overlay directly this
 * file is only used by tests.
 */

import { render } from 'solid-js/web';
import TutorialOverlay from './TutorialOverlay';
import { startTutorial } from './state';

const HOST_ID = 'nbt-dev-host';

/**
 * Attach the overlay to a detached host div. Pass `{ start: false }` to mount
 * without opening the tour. Returns a disposer; safe to call repeatedly.
 */
export function mountTutorialDev(options: { start?: boolean } = {}): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (window.__nbTutorial !== undefined || document.getElementById(HOST_ID) !== null) {
    if (options.start !== false) startTutorial();
    return () => undefined;
  }
  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);
  const dispose = render(() => <TutorialOverlay />, host);
  if (options.start !== false) startTutorial();
  return () => {
    dispose();
    host.remove();
  };
}

export default mountTutorialDev;
