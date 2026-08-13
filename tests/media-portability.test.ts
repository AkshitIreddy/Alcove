import { describe, expect, it } from 'vitest';
import { extensionForMedia } from '../src/editor/menu/blockPortability';
import { videoFileExtension } from '../src/editor/media/assets';

describe('portable media names', () => {
  it('never relabels accepted image bytes as png', () => {
    expect(extensionForMedia('image/avif', undefined, 'png')).toBe('avif');
    expect(extensionForMedia('image/svg+xml', undefined, 'png')).toBe('svg');
    expect(extensionForMedia('application/octet-stream', 'images/hash.bmp', 'png')).toBe('bmp');
  });

  it('normalizes browser video MIME subtypes to real extensions', () => {
    expect(videoFileExtension(new File(['x'], 'clip.mov', { type: 'video/quicktime' }))).toBe('mov');
    expect(videoFileExtension(new File(['x'], 'clip.avi', { type: 'video/x-msvideo' }))).toBe('avi');
    expect(extensionForMedia('video/x-matroska', undefined, 'mp4')).toBe('mkv');
  });
});
