/**
 * src/features/transfer — customizable export, additive import, long-lived
 * undo (roadmap item 29).
 *
 * Public surface for the rest of the app:
 *
 *   openTransferPanel('export' | 'import' | 'history')  ← rail / menu hook
 *   exportEntireLibrary()                               ← one-click backup
 *
 * Everything else (format, zip codec, scope planning, conflict matrix,
 * restore points) is importable for tests and future features but the app
 * only needs these two.
 */

export {
  TransferPanel,
  openTransferPanel,
  isTransferPanelOpen,
  type TransferTab,
} from './TransferPanel';

export {
  BUNDLE_EXTENSION,
  BUNDLE_SCHEMA_VERSION,
  describeCounts,
  formatBytes,
  parseManifest,
  type BundleManifest,
  type ManifestBookcase,
} from './format';

export {
  DEFAULT_EXPORT_OPTIONS,
  buildExportPlan,
  emptyLibrarySnapshot,
  resolveScopeSelection,
  suggestedFileName,
  type BookcaseSnapshot,
  type ExportOptions,
  type ExportPlan,
  type ExportScope,
  type LibrarySnapshot,
} from './scope';

export {
  buildImportPlan,
  buildLibraryIndex,
  defaultResolution,
  planBookcases,
  type BookResolution,
  type BookcasePlan,
  type ImportPlan,
} from './conflicts';

export {
  DEFAULT_RETENTION,
  applyRetention,
  describeRestorePoint,
  planRevert,
  type RestorePoint,
  type RetentionPolicy,
} from './restore';

export { loadHistory, setRetention } from './store';
export { applyImportPlan, loadLibrarySnapshot, revertRestorePoint } from './library';
export { pickAndReadBundle, readBundleBytes, writeBundle } from './io';

import { notify } from '../../editor/script/exporters/toast';
import { formatBytes } from './format';
import { loadLibrarySnapshot } from './library';
import { writeBundle } from './io';
import { APP_VERSION } from '../../version';
import {
  DEFAULT_EXPORT_OPTIONS,
  buildExportPlan,
  resolveScopeSelection,
  suggestedFileName,
} from './scope';

/**
 * One-click "everything, packed" — the shelf menu's backup action. Same
 * pipeline as the panel with the default options and a library-wide scope.
 */
export async function exportEntireLibrary(): Promise<boolean> {
  try {
    const snapshot = await loadLibrarySnapshot();
    const scope = { kind: 'library' as const };
    const plan = buildExportPlan(
      snapshot,
      resolveScopeSelection(snapshot, scope),
      DEFAULT_EXPORT_OPTIONS,
    );
    if (plan.empty) {
      notify('there is nothing on the shelves to export yet');
      return false;
    }
    const fileName = suggestedFileName(plan, scope, DEFAULT_EXPORT_OPTIONS);
    const result = await writeBundle(
      {
        snapshot,
        plan,
        options: DEFAULT_EXPORT_OPTIONS,
        label: 'The whole library',
        createdAt: new Date().toISOString(),
        appVersion: APP_VERSION,
      },
      fileName,
      false,
    );
    if (result.outcome === 'saved') {
      notify(`${fileName} · ${formatBytes(result.bytes)}`);
      return true;
    }
    if (result.outcome === 'failed') notify('could not write the bundle');
    return false;
  } catch {
    notify('could not build the bundle');
    return false;
  }
}
