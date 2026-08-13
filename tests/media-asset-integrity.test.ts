import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  execute: vi.fn(async () => ({ rowsAffected: 1 })),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: native.invoke,
}));

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn(async () => ({
      select: vi.fn(async () => []),
      execute: native.execute,
    })),
  },
}));

import {
  promoteFetchedImageAssets,
  type FetchedImageAssetReceipt,
} from '../src/editor/media/assets';

const reviewed: FetchedImageAssetReceipt = {
  id: 'img_reviewed',
  relPath: 'images/reviewed.png',
  url: 'https://images.example/reviewed.png',
  thumbUrl: null,
  attribution: 'Example creator',
  license: 'CC0',
  sha256: 'expected-sha256',
  sizeBytes: 2048,
  provider: 'openverse',
  query: 'reviewed image',
};

describe('reviewed fetched-image promotion', () => {
  beforeEach(() => {
    native.invoke.mockReset();
    native.execute.mockClear();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('reopens and verifies the exact reviewed bytes before indexing them', async () => {
    native.invoke.mockResolvedValue({
      relPath: reviewed.relPath,
      sha256: reviewed.sha256,
      sizeBytes: reviewed.sizeBytes,
    });

    await promoteFetchedImageAssets([reviewed]);

    expect(native.invoke).toHaveBeenCalledWith('verify_image_asset', {
      relPath: reviewed.relPath,
    });
    expect(native.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['path', { relPath: 'images/replaced.png', sha256: reviewed.sha256, sizeBytes: reviewed.sizeBytes }],
    ['digest', { relPath: reviewed.relPath, sha256: 'tampered', sizeBytes: reviewed.sizeBytes }],
    ['size', { relPath: reviewed.relPath, sha256: reviewed.sha256, sizeBytes: reviewed.sizeBytes + 1 }],
  ])('fails closed on a changed %s without creating an asset row', async (_field, actual) => {
    native.invoke.mockResolvedValue(actual);

    await expect(promoteFetchedImageAssets([reviewed])).rejects.toThrow(
      'changed after the reviewed preview',
    );
    expect(native.execute).not.toHaveBeenCalled();
  });
});
