/** Exercise actual todo checkboxes in an isolated browser library on :1420. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? 'E:/temp/alcove-todo';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__shelfWorld?.ready && typeof globalThis.__shelfVisibleBooks === 'function');
  await page.evaluate(() => globalThis.__shelfWorld.ready);
  await page.evaluate(async () => {
    const book = globalThis.__shelfVisibleBooks().find(b => /Welcome/i.test(b.title));
    const { appState } = await import('/src/state/app.ts');
    appState.openBook(book.id);
  });
  await page.waitForSelector('.nb-flip-surface .ProseMirror h1');
  await page.evaluate(async () => (await import('/src/features/tutorial/state.ts')).stopTutorial(true));
  await page.evaluate(() => document.fonts.ready);
  const checkbox = page.locator('.nb-flip-leaf-right .ProseMirror input[type=checkbox]').first();
  await checkbox.waitFor({ state: 'attached' });
  await page.screenshot({ path: `${out}/before.png` });
  const before = await checkbox.isChecked();
  await checkbox.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  const after = await checkbox.isChecked();
  assert.notEqual(after, before, 'A pointer click must toggle the task');
  const item = await checkbox.evaluate(input => input.closest('li').outerHTML);
  await checkbox.focus();
  await page.keyboard.press('Space');
  assert.equal(await checkbox.isChecked(), before, 'Space must toggle the task back');
  await checkbox.click();
  const pageId = await checkbox.evaluate(input => input.closest('[data-page-id]').dataset.pageId);
  await page.waitForFunction(async id => {
    const { getPage } = await import('/src/data/pages.ts');
    const page = await getPage(id);
    return JSON.stringify(page?.doc).includes('"checked":true');
  }, pageId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__shelfWorld?.ready);
  await page.evaluate(() => globalThis.__shelfWorld.ready);
  await page.evaluate(async () => {
    const { appState } = await import('/src/state/app.ts');
    if (!document.querySelector('.nb-flip-surface .ProseMirror')) {
      appState.openBook(globalThis.__shelfVisibleBooks().find(b => /Welcome/i.test(b.title)).id);
    }
  });
  await checkbox.waitFor({ state: 'attached' });
  assert.equal(await checkbox.isChecked(), true, 'The saved task must stay checked after reload');
  // Open an empty writing line, then create the task through the slash menu.
  await checkbox.evaluate(input => {
    const editor = input.closest('.ProseMirror').editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
    });
    editor.commands.focus('end');
  });
  await page.keyboard.type('/todo');
  await page.getByRole('option', { name: /To-do list/ }).click();
  await page.keyboard.type('New regression task');
  const created = page.getByRole('checkbox', { name: /New regression task/ });
  await created.click();
  assert.equal(await created.isChecked(), true, 'New task items must toggle too');
  await page.screenshot({ path: `${out}/after.png` });
  const report = { before, after, keyboard: true, persisted: true, created: true, item, errors };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (before === after || errors.length) process.exitCode = 1;
} finally { await browser.close(); }
