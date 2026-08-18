import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLibraryInfo: vi.fn(async () => ({ assetsRoot: 'C:/Library/assets' })),
  readAiAttachment: vi.fn(async (id: string) => ({
    metadata: {
      id,
      kind: 'png',
      mimeType: 'image/png',
      sizeBytes: 4,
      sha256: 'managed-image-digest',
    },
    bytes: [1, 2, 3, 4],
  })),
}));

vi.mock('../src/data/db', () => ({
  isTauri: () => true,
  getLibraryInfo: mocks.getLibraryInfo,
}));

vi.mock('../src/data/aiGateway', () => ({
  readAiAttachment: mocks.readAiAttachment,
}));

import { resolveAssetSrc } from '../src/editor/media/resolver';

describe('Tauri Agent attachment media resolution', () => {
  beforeEach(() => {
    mocks.getLibraryInfo.mockClear();
    mocks.readAiAttachment.mockClear();
  });

  it('uses managed bytes and a clone-safe blob URL before the asset protocol', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:alcove-agent-managed-image');
    try {
      const resolved = await resolveAssetSrc(
        'ai/attachments/managed-image-for-native-preview.png',
      );
      expect(resolved).toBe('blob:alcove-agent-managed-image');
      expect(mocks.readAiAttachment).toHaveBeenCalledWith(
        'managed-image-for-native-preview.png',
      );
      expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
      expect(mocks.getLibraryInfo).not.toHaveBeenCalled();
    } finally {
      createObjectUrl.mockRestore();
    }
  });
});
