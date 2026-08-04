import { chromium } from 'playwright';

export const OUT = 'C:/Users/akshi/Desktop/Code Palace/notebook app/qa/newreader';
export const URL_BASE = 'http://localhost:1420';

export async function attach() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();
  return { browser, ctx, page };
}

export function watchErrors(page) {
  const errors = new Map();
  page.on('pageerror', (e) => {
    const k = `pageerror ${e.message.split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const k = `console ${m.text().split('\n')[0].slice(0, 220)}`;
      errors.set(k, (errors.get(k) ?? 0) + 1);
    }
  });
  return errors;
}

export function dumpErrors(errors) {
  if (errors.size === 0) return;
  console.log('--- page errors ---');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}

export async function poll(page, fn, timeout = 45000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(200);
  }
}

export async function tryPoll(page, fn, timeout, label) {
  try {
    return await poll(page, fn, timeout, label);
  } catch {
    return null;
  }
}

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p });
  console.log(`  shot ${name}.png`);
  return p;
}

export const tourState = (page) => page.evaluate(() => window.__nbTutorial?.getState?.() ?? null);

export const fails = [];
export const check = (ok, line) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${line}`);
  if (!ok) fails.push(line);
};
export const note = (line) => console.log(`  ..  ${line}`);
