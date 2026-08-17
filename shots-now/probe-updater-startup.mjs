/** Prove a failed automatic check retries and opens the signed update offer. */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const sabotage = process.argv.includes('--sabotage');
const out = `qa/updater-startup/${sabotage ? 'sabotage' : 'retry-recovery'}`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.addInitScript(({ breakGate }) => {
  globalThis.__alcoveUpdaterQa = {
    currentVersion: '0.7.1',
    automaticDelayMs: 80,
    retryDelaysMs: [140, 260],
    calls: 0,
    async check() {
      this.calls += 1;
      if (this.calls === 1) return { status: 'error', message: 'briefly offline' };
      if (breakGate) return { status: 'current' };
      return {
        status: 'available',
        version: '0.7.2',
        date: '2026-08-17T12:06:09.036Z',
        body: '## Automatic check recovered\n\nThe second bounded check found this edition.',
      };
    },
  };
}, { breakGate: sabotage });

await page.goto('http://127.0.0.1:1420/?fx=force&qa=updater', {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
const dialog = page.getByRole('dialog', { name: 'A new Alcove is ready' });
if (!sabotage) await dialog.waitFor({ state: 'visible', timeout: 15_000 });
else await page.waitForTimeout(1_200);
const calls = await page.evaluate(() => globalThis.__alcoveUpdaterQa?.calls ?? -1);
const visible = await dialog.isVisible().catch(() => false);
await page.screenshot({ path: `${out}/startup.png` });
if (visible) await dialog.screenshot({ path: `${out}/dialog.png` });

const checks = {
  retriedExactlyOnce: calls === 2,
  updateOfferVisible: visible,
  correctVersion: visible && (await dialog.innerText()).includes('version 0.7.2'),
  noRuntimeErrors: errors.length === 0,
};
const passed = Object.values(checks).every(Boolean);
writeFileSync(`${out}/report.json`, `${JSON.stringify({ calls, checks, errors, passed }, null, 2)}\n`);
await browser.close();

if (sabotage) {
  if (passed) {
    console.error('GATE INERT · missing recovered update offer escaped startup gate');
    process.exit(1);
  }
  console.log('GATE ALIVE · missing recovered update offer was rejected');
} else if (!passed) {
  console.error(`updater startup: FAILED\n${JSON.stringify(checks, null, 2)}`);
  process.exit(1);
} else {
  console.log('updater startup: PASS · first failure recovered on bounded retry');
}
