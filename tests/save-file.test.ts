import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  save: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: native.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: native.writeFile }));

import {
  NOTEBOOK_SCRIPT_SPEC_FILE_NAME,
  downloadNotebookScriptSpec,
  saveBytes,
} from '../src/editor/script/exporters/saveFile';

const ROOT = resolve(__dirname, '..');

function useTauriRuntime(): void {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
}

describe('file saving', () => {
  beforeEach(() => {
    native.save.mockReset();
    native.writeFile.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('allows plugin-fs to write the path granted by the native save picker', () => {
    const capability = JSON.parse(
      readFileSync(resolve(ROOT, 'src-tauri/capabilities/default.json'), 'utf8'),
    ) as { permissions: unknown[] };

    expect(capability.permissions).toContain('dialog:default');
    expect(capability.permissions).toContain('fs:allow-write-file');
  });

  it('writes bytes to the exact path chosen in Tauri', async () => {
    useTauriRuntime();
    native.save.mockResolvedValue('C:\\Users\\Reader\\Downloads\\guide.md');
    native.writeFile.mockResolvedValue(undefined);
    const bytes = new TextEncoder().encode('# Notebook Script');

    await expect(
      saveBytes(bytes, 'guide.md', 'text/markdown', [
        { name: 'Markdown', extensions: ['md'] },
      ]),
    ).resolves.toBe('saved');

    expect(native.save).toHaveBeenCalledWith({
      defaultPath: 'guide.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    expect(native.writeFile).toHaveBeenCalledWith(
      'C:\\Users\\Reader\\Downloads\\guide.md',
      bytes,
    );
  });

  it('does not write when the native picker is cancelled', async () => {
    useTauriRuntime();
    native.save.mockResolvedValue(null);

    await expect(
      saveBytes(new Uint8Array([1]), 'guide.md', 'text/markdown', []),
    ).resolves.toBe('cancelled');
    expect(native.writeFile).not.toHaveBeenCalled();
  });

  it('keeps browser development on the object-URL download path', async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click,
      remove,
    };
    const createObjectURL = vi.fn(() => 'blob:alcove-guide');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    await expect(
      saveBytes(
        new Uint8Array([35, 32, 65, 73]),
        'guide.md',
        'text/markdown;charset=utf-8',
        [],
      ),
    ).resolves.toBe('saved');

    expect(anchor.download).toBe('guide.md');
    expect(anchor.href).toBe('blob:alcove-guide');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(4000);
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:alcove-guide');
  });

  it('encodes the complete AI guide as a Markdown attachment', async () => {
    const saver = vi.fn().mockResolvedValue('saved');
    const guide = '# Notebook Script\n\nUse `:::callout`.';

    await expect(downloadNotebookScriptSpec(guide, saver)).resolves.toBe('saved');
    expect(saver).toHaveBeenCalledOnce();
    const [bytes, name, mime, filters] = saver.mock.calls[0] as [
      Uint8Array,
      string,
      string,
      Array<{ name: string; extensions: string[] }>,
    ];
    expect(new TextDecoder().decode(bytes)).toBe(guide);
    expect(name).toBe(NOTEBOOK_SCRIPT_SPEC_FILE_NAME);
    expect(mime).toBe('text/markdown;charset=utf-8');
    expect(filters).toEqual([{ name: 'Markdown', extensions: ['md'] }]);
  });
});
