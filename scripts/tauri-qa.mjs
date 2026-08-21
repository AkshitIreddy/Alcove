/**
 * Launch Alcove's native QA shell without touching or appearing beside the
 * reader's app. The child gets a fresh Windows data root, a hidden/taskbar-free
 * window from tauri.qa.conf.json, a silent frontend URL, and a fixed WebView2
 * debugging port for Playwright.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const suppliedRoot = process.env.ALCOVE_QA_APPDATA?.trim();
const qaRoot = resolve(suppliedRoot || mkdtempSync(join(tmpdir(), 'alcove-qa-')));
const qaRoamingRoot = join(qaRoot, 'Roaming');
const qaLocalRoot = join(qaRoot, 'Local');
const qaTempRoot = join(qaRoot, 'Temp');
const qaNpmCache = join(qaRoot, 'npm-cache');
const qaNpmPrefix = join(qaRoot, 'npm-prefix');
const qaWebViewData = join(qaLocalRoot, 'WebView2');
for (const directory of [
  qaRoamingRoot,
  qaLocalRoot,
  qaTempRoot,
  qaNpmCache,
  qaNpmPrefix,
  qaWebViewData,
]) {
  mkdirSync(directory, { recursive: true });
}

for (const productionRoot of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
  if (productionRoot && resolve(productionRoot) === qaRoot) {
    throw new Error('Alcove QA data root must not be a production app-data root');
  }
}

const tauriCli = resolve('node_modules', '@tauri-apps', 'cli', 'tauri.js');
const qaExecutable = resolve('src-tauri', 'target', 'debug', 'alcove.exe');
const escapedQaExecutable = qaExecutable.replaceAll("'", "''");
const existingWebViewArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS?.trim();
const debugPort = process.env.ALCOVE_QA_CDP_PORT?.trim() || '9222';
if (!/^\d{2,5}$/.test(debugPort) || Number(debugPort) > 65_535) {
  throw new Error('ALCOVE_QA_CDP_PORT must be a valid TCP port');
}
const requiredWebViewArgs = [
  `--remote-debugging-port=${debugPort}`,
  '--mute-audio',
  '--autoplay-policy=user-gesture-required',
].join(' ');
const webViewArgs = existingWebViewArgs
  ? `${existingWebViewArgs} ${requiredWebViewArgs}`
  : requiredWebViewArgs;

process.stdout.write(`Alcove QA data root: ${qaRoot}\n`);
process.stdout.write(`Alcove QA CDP: http://127.0.0.1:${debugPort}\n`);
process.stdout.write('Alcove QA window: hidden · taskbar: hidden · audio: forced silent\n');

const child = spawn(
  process.execPath,
  [tauriCli, 'dev', '--no-watch', '--config', resolve('src-tauri', 'tauri.qa.conf.json')],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APPDATA: qaRoamingRoot,
      LOCALAPPDATA: qaLocalRoot,
      TEMP: qaTempRoot,
      TMP: qaTempRoot,
      ALCOVE_QA: '1',
      ALCOVE_QA_APPDATA: qaRoot,
      ALCOVE_QA_CDP_PORT: debugPort,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webViewArgs,
      WEBVIEW2_USER_DATA_FOLDER: qaWebViewData,
      // Tauri's CLI asks npm for plugin metadata. Pin npm's own paths so
      // changing APPDATA cannot make it reinterpret a Windows drive path as a
      // relative `C;\\...` folder inside the checkout.
      npm_config_cache: qaNpmCache,
      npm_config_prefix: qaNpmPrefix,
    },
    stdio: 'inherit',
    windowsHide: true,
  },
);

let stopping = false;
const stopChildTree = (signal) => {
  if (stopping || child.exitCode !== null || child.pid === undefined) return;
  stopping = true;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    // Cargo can start a GUI binary outside the console job inherited from the
    // CLI. Kill only this checkout's debug executable by its exact path; the
    // installed reader app lives elsewhere and must never be a target.
    spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escapedQaExecutable}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    ], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill(signal);
  }
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopChildTree(signal));
}
child.on('exit', (code, signal) => {
  if (signal && !stopping) process.kill(process.pid, signal);
  else process.exitCode = stopping ? 130 : (code ?? 1);
});
