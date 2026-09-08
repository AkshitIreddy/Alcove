/**
 * Snapshot compatibility export for the shared live/staged ruling geometry.
 * Keep one implementation: an older special-to-ordinary-only copy caused
 * destination ink to jump down when the curl handed ownership to live DOM.
 */
export { proseGridCorrections as snapshotGridCorrections } from '../editor/proseGrid';
