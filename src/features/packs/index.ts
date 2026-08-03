/**
 * src/features/packs/index.ts — the door.
 *
 * Hosts import from here rather than reaching into the modules, so the split
 * between the pure half (schema, categories, validate, prompt — all node-
 * testable, no Solid, no SQLite) and the wired half (store, intake, the two
 * components) stays a decision rather than an accident.
 */
export {
  PACK_CATEGORIES,
  UNSUPPORTED_CATEGORIES,
  isPackCategoryId,
  packCategory,
} from './categories';
export {
  PACK_FORMAT,
  fieldKeys,
  fieldSummary,
  type PackCategory,
  type PackCategoryId,
  type PackCheck,
  type PackField,
  type PackProblem,
  type UnsupportedCategory,
} from './schema';
export {
  exampleJsonInPrompt,
  promptForCategory,
} from './prompt';
export {
  parsePackText,
  validatePack,
  validatePackItem,
  validatePackText,
  type PackItem,
  type ValidatedPack,
} from './validate';
export {
  MAX_PACKS,
  applyEntry,
  entriesIn,
  forgetPack,
  installPack,
  loadUserPacks,
  packsIn,
  resetUserPacksForTests,
  shelfDesignOfItem,
  snapshotUserPacks,
  userPacks,
  wallpaperSpecOf,
  type InstallReport,
  type InstalledPack,
  type PackEntry,
} from './store';
export { PackDialog, openPackDialog } from './PackDialog';
export { default as PacksPanel } from './PacksPanel';
export { default as YourDesigns } from './YourDesigns';
