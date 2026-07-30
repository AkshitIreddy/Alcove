/**
 * src/features/tutorial — the hand-drawn guided tour.
 *
 * Integration is two lines in the app shell:
 *
 *   import TutorialOverlay, { maybeAutoStartTutorial } from './features/tutorial';
 *   onMount(() => { void maybeAutoStartTutorial(); });
 *   // ...and render <TutorialOverlay /> once, anywhere in the tree.
 *
 * Settings gets one row:
 *
 *   <button onClick={() => { onClose(); void replayTutorial(); }}>replay</button>
 */

export { default as TutorialOverlay, default } from './TutorialOverlay';
export {
  TUTORIAL_KEY,
  TUTORIAL_SETTING_FIELD,
  maybeAutoStartTutorial,
  readCompleted as isTutorialCompleted,
  replayTutorial,
  resetTutorial,
  startTutorial,
  stopTutorial,
  tutorialRunToken,
  tutorialRunning,
} from './state';
export { TUTORIAL_STEPS, TUTORIAL_STEP_IDS, type TutorialStep } from './steps';
