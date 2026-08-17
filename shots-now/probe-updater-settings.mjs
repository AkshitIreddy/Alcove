/**
 * Real Settings -> signed updater UI witness.
 *
 *   node shots-now/probe-updater-settings.mjs --scenario=available
 *   node shots-now/probe-updater-settings.mjs --scenario=current --width=1100 --height=760
 *   node shots-now/probe-updater-settings.mjs --scenario=error
 *   node shots-now/probe-updater-settings.mjs --scenario=available --sabotage
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const scenario = option('scenario', 'available');
const width = Number(option('width', '1500'));
const height = Number(option('height', '940'));
const sabotage = args.includes('--sabotage');
if (!['available', 'current', 'error'].includes(scenario)) {
  throw new Error(`unknown scenario ${scenario}`);
}

const out = `qa/updater-settings/${scenario}-${width}x${height}${sabotage ? '-sabotage' : ''}`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width, height } });
const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()}`));

await page.addInitScript(({ kind, breakGate }) => {
  globalThis.__alcoveUpdaterQa = {
    currentVersion: breakGate ? '9.9.9' : '0.7.1',
    disableAutomatic: true,
    calls: 0,
    async check() {
      this.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (kind === 'available') {
        return {
          status: 'available',
          version: '0.7.2',
          date: '2026-08-17T12:06:09.036Z',
          body: '## What’s new\n\n- **Writing desks** — 25 soft colours, with Linen first.\n- **AI Agent** — more reliable Cohere connection checks.',
        };
      }
      if (kind === 'error') {
        return { status: 'error', message: 'release feed timed out' };
      }
      return { status: 'current' };
    },
  };
}, { kind: scenario, breakGate: sabotage });

await page.goto('http://127.0.0.1:1420/?fx=force&qa=updater', {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
for (let attempt = 0; attempt < 8; attempt += 1) {
  const skip = page.getByText('skip the tour', { exact: false });
  if ((await skip.count()) === 0) break;
  await skip.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(250);
}
await page.keyboard.press('Escape').catch(() => {});

await page.getByRole('button', { name: 'Settings', exact: true }).click();
const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
await settings.waitFor({ state: 'visible', timeout: 30_000 });
await page.getByPlaceholder('search the settings…').fill('updates');
const checkButton = page.getByRole('button', { name: 'check now', exact: true });
await checkButton.waitFor({ state: 'visible' });
const row = checkButton.locator('xpath=ancestor::*[contains(@class,"nbs-row")]').first();
const before = await row.innerText();
await checkButton.click();
await page.getByRole('button', { name: 'checking…', exact: true }).waitFor({ state: 'visible' });

let outcomeText = '';
if (scenario === 'available') {
  const dialog = page.getByRole('dialog', { name: 'A new Alcove is ready' });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  outcomeText = await dialog.innerText();
  await page.screenshot({ path: `${out}/update-available.png` });
  await dialog.screenshot({ path: `${out}/update-dialog.png` });
  await page.getByRole('button', { name: 'Close update' }).click();
} else {
  const expected = scenario === 'current'
    ? /Alcove 0\.7\.1 is current\./
    : /Could not check: release feed timed out/;
  await row.getByText(expected).first().waitFor({ state: 'visible', timeout: 15_000 });
  outcomeText = await row.innerText();
  await page.screenshot({ path: `${out}/${scenario}.png` });
  await row.screenshot({ path: `${out}/${scenario}-row.png` });
}

await page.getByPlaceholder('search the settings…').fill('');
const footer = settings.locator('.nbs-footnote');
await footer.scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
const footerText = await footer.innerText();
await page.screenshot({ path: `${out}/settings-footer.png` });
await footer.screenshot({ path: `${out}/footer.png` });

const calls = await page.evaluate(() => globalThis.__alcoveUpdaterQa?.calls ?? -1);
const checks = {
  exactOneCheck: calls === 1,
  installedVersionBefore: before.includes('installed: 0.7.1'),
  correctOutcome: scenario === 'available'
    ? outcomeText.includes('version 0.7.2') && outcomeText.includes('Update now')
    : scenario === 'current'
      ? outcomeText.includes('Alcove 0.7.1 is current.')
      : outcomeText.includes('Could not check: release feed timed out'),
  footerVersion: footerText.startsWith('Alcove 0.7.1 ·'),
  noConsoleErrors: consoleErrors.length === 0,
  noPageErrors: pageErrors.length === 0,
  noRequestFailures: requestFailures.length === 0,
  noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
};
const passed = Object.values(checks).every(Boolean);
const report = {
  scenario,
  viewport: { width, height },
  sabotage,
  calls,
  before,
  outcomeText,
  footerText,
  checks,
  consoleErrors,
  pageErrors,
  requestFailures,
  passed,
};
writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

if (sabotage) {
  if (passed) {
    console.error('GATE INERT · wrong installed version escaped the updater visual gate');
    process.exit(1);
  }
  console.log('GATE ALIVE · wrong installed version was rejected');
} else if (!passed) {
  console.error(`updater settings: FAILED · ${scenario}@${width}x${height}`);
  console.error(JSON.stringify(checks, null, 2));
  process.exit(1);
} else {
  console.log(`updater settings: PASS · ${scenario}@${width}x${height}`);
}
