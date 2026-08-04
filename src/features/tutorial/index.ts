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
 *
 * The tour watches the app from the outside only — DOM events and selectors
 * other features already render (see ./probe.ts). Nothing outside this folder
 * has to know it exists, and nothing here can break the app it is describing.
 */

export { default as TutorialOverlay, default } from './TutorialOverlay';
export {
  TUTORIAL_KEY,
  TUTORIAL_SETTING_FIELD,
  maybeAutoStartTutorial,
  readCompleted as isTutorialCompleted,
  replayTutorial,
  resetTutorial,
  setTutorialLength,
  startTutorial,
  stopTutorial,
  tutorialLength,
  tutorialLengthChosen,
  tutorialRunToken,
  tutorialRunning,
} from './state';
export {
  PANEL_DWELL_MS,
  SHORT_TOUR_STEP_IDS,
  TUTORIAL_STEPS,
  TUTORIAL_STEP_IDS,
  stepTargets,
  tourSteps,
  type StepTarget,
  type StepTask,
  type TourLength,
  type TutorialStep,
} from './steps';
export { DISMISSIBLE, dismissStale, openSurfaceIds } from './dismiss';
export { SURFACE_FACTS, type TourFactKey } from './probe';
// The contract a panel rides a tour step on — both directions of it. See
// ./tourStep.ts for why it is a module rather than a string in two files.
export {
  TOUR_LAYER_SELECTOR,
  TOUR_STEP_ATTR,
  stepWatchVerdict,
  type StepWatch,
  type StepWatchVerdict,
} from './tourStep';
