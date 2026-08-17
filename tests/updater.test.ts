import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }));
vi.mock('../src/features/system/UpdateDialog', () => ({
  openUpdateDialog: mocks.open,
}));
vi.mock('../src/data/db', () => ({ isTauri: () => true }));

import {
  UPDATE_CHECK_DELAY_MS,
  UPDATE_RETRY_DELAYS_MS,
  checkForUpdates,
  scheduleUpdateChecks,
  type UpdateCheckResult,
} from '../src/features/system/updater';

beforeEach(() => {
  mocks.check.mockReset();
  mocks.open.mockReset();
  vi.restoreAllMocks();
});

describe('signed updater checks', () => {
  it('distinguishes current, available, and failed checks instead of swallowing them', async () => {
    mocks.check.mockResolvedValueOnce(null);
    await expect(checkForUpdates()).resolves.toEqual({ status: 'current' });
    expect(mocks.open).not.toHaveBeenCalled();

    const update = { version: '0.7.3' };
    mocks.check.mockResolvedValueOnce(update);
    await expect(checkForUpdates()).resolves.toEqual({
      status: 'available',
      version: '0.7.3',
    });
    expect(mocks.open).toHaveBeenCalledWith(update);

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.check.mockRejectedValueOnce(new Error('release feed timed out'));
    await expect(checkForUpdates()).resolves.toEqual({
      status: 'error',
      message: 'release feed timed out',
    });
  });

  it('shares one request when startup and Settings check together', async () => {
    let resolve!: (value: null) => void;
    mocks.check.mockReturnValueOnce(new Promise<null>((done) => { resolve = done; }));
    const startup = checkForUpdates();
    const manual = checkForUpdates();
    await vi.waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(1));
    resolve(null);
    await expect(Promise.all([startup, manual])).resolves.toEqual([
      { status: 'current' },
      { status: 'current' },
    ]);
  });
});

describe('startup update schedule', () => {
  it('retries two failures, accelerates a pending retry when online, then stops', async () => {
    const outcomes: UpdateCheckResult[] = [
      { status: 'error', message: 'offline' },
      { status: 'error', message: 'still offline' },
      { status: 'current' },
    ];
    const timers = new Map<number, () => void>();
    const delays: number[] = [];
    let nextTimer = 0;
    let online: (() => void) | null = null;
    const clearTimer = vi.fn((handle: number) => { timers.delete(handle); });
    const check = vi.fn(async () => outcomes.shift()!);
    const fire = (handle: number): void => {
      const callback = timers.get(handle)!;
      timers.delete(handle);
      callback();
    };
    const dispose = scheduleUpdateChecks({
      setTimer(callback, delay) {
        const id = ++nextTimer;
        timers.set(id, callback);
        delays.push(delay);
        return id;
      },
      clearTimer,
      onOnline(callback) {
        online = callback;
        return () => { online = null; };
      },
      check,
    });

    expect(delays).toEqual([UPDATE_CHECK_DELAY_MS]);
    fire(1);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(delays).toEqual([UPDATE_CHECK_DELAY_MS, UPDATE_RETRY_DELAYS_MS[0]]);

    online!();
    expect(clearTimer).toHaveBeenCalledWith(2);
    expect(delays.at(-1)).toBe(0);
    fire(3);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(delays.at(-1)).toBe(UPDATE_RETRY_DELAYS_MS[1]);

    fire(4);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(3));
    expect(timers.size).toBe(0);
    dispose();
    expect(online).toBeNull();
  });
});

describe('Settings updater surface', () => {
  it('contains a manual action, an announced outcome, and the version footer', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile(new URL('../src/features/settings/SettingsPanel.tsx', import.meta.url), 'utf8'),
    );
    expect(source).toContain('label="check for updates"');
    expect(source).toContain('onClick={() => void checkUpdatesNow()}');
    expect(source).toContain('role="status"');
    expect(source).toContain('Alcove {appVersion() ?? APP_VERSION}');
  });
});
