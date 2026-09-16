/** Open real dropdowns and check their saved continuation across book pages. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? 'E:/temp/alcove-details-pagination';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'] });
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const report = [];
try {
  for (const scenario of ['partial', 'lone', 'long-paragraph', 'nested-list', 'typing']) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 850 } });
    const page = await context.newPage();
    await page.routeWebSocket('**', socket => socket.close());
    await page.goto('http://127.0.0.1:1420/?fx=force');
    await page.waitForFunction(() => !!globalThis.__shelfWorld?.ready);
    await page.evaluate(() => globalThis.__shelfWorld.ready);
    await page.evaluate(async () => (await import('/src/features/tutorial/state.ts')).stopTutorial(true));
    await page.evaluate(() => document.fonts.ready);
    const body = scenario === 'typing' ? [paragraph('Beginning ')] : scenario === 'nested-list'
      ? [{ type: 'orderedList', attrs: { start: 4 }, content: Array.from({ length: 30 }, (_, i) => ({ type: 'listItem', content: [paragraph(`Nested item ${i + 1}`)] })) }]
      : scenario === 'long-paragraph'
      ? [paragraph(Array.from({ length: 220 }, (_, i) => `word${i + 1}`).join(' '))]
      : Array.from({ length: 30 }, (_, i) => paragraph(`Dropdown line ${i + 1}`));
    const fixture = await page.evaluate(async ({ prefix, body }) => {
      const { createBook } = await import('/src/data/books.ts');
      const { createPage } = await import('/src/data/pages.ts');
      const { appState } = await import('/src/state/app.ts');
      const bookId = `qa-details-${Date.now()}`;
      await createBook({ id: bookId, title: 'Dropdown pagination', floor: 0, slot: 46 });
      const left = await createPage({ bookId, ord: 0, doc: { type: 'doc', content: [
        ...prefix,
        { type: 'details', attrs: { open: false }, content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: 'A dropdown that continues' }] },
          { type: 'detailsContent', content: body },
        ] },
      ] } });
      await createPage({ bookId, ord: 1, doc: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Following page content' }] },
      ] } });
      appState.openBook(bookId);
      return { bookId, leftId: left.id };
    }, { prefix: scenario === 'lone' ? [] : Array.from({ length: 6 }, (_, i) => paragraph(`Earlier line ${i + 1}`)), body });
    const toggle = page.locator('.nb-flip-leaf-left [data-type=details] > button').first();
    await toggle.waitFor();
    await toggle.click();
    if (scenario === 'typing') {
      const text = Array.from({ length: 220 }, (_, i) => `word${i + 1}`).join(' ');
      await page.locator('.nb-flip-leaf-left [data-type=detailsContent] p').click();
      await page.keyboard.press('End');
      await page.keyboard.insertText(text);
      body[0].content[0].text += text;
    }
    let failure;
    try {
      await page.waitForFunction(async ({ bookId, leftId }) => {
        const { listPages } = await import('/src/data/pages.ts');
        const rows = await listPages(bookId);
        return rows.filter(row => row.doc.content.some(node => node.type === 'details')).length >= 2 &&
          rows.find(row => row.id === leftId)?.doc.content.some(node => node.type === 'details');
      }, fixture, { timeout: 7000 });
    } catch (error) { failure = error.message; }
    await page.screenshot({ path: `${out}/${scenario}.png`, caret: 'hide' });
    const state = await page.evaluate(async ({ bookId }) => {
      const { listPages } = await import('/src/data/pages.ts');
      return { rows: await listPages(bookId), boxes: [...document.querySelectorAll('.nb-flip-surface .nb-prose')].map(root => {
        const rect = root.getBoundingClientRect();
        const scale = rect.height / root.clientHeight;
        const limit = rect.bottom - parseFloat(getComputedStyle(root).paddingBottom) * scale;
        return { limit, details: [...root.querySelectorAll('[data-type=details]')].map(el => ({ bottom: el.getBoundingClientRect().bottom, text: el.textContent })) };
      }) };
    }, fixture);
    const textOf = node => node.type === 'text' ? node.text : (node.content ?? []).map(textOf).join('');
    const bodies = state.rows.flatMap(row => row.doc.content.filter(node => node.type === 'details').map(node => node.content[1]));
    const preserved = bodies.map(textOf).join('') === body.map(textOf).join('');
    const fits = state.boxes.every(box => box.details.every(detail => detail.bottom <= box.limit + 1));
    const fillsFirst = state.rows.find(row => row.id === fixture.leftId)?.doc.content.some(node => node.type === 'details');
    let interaction = false;
    if (scenario === 'typing' && preserved && fits && fillsFirst) {
      assert(await page.evaluate(() => !!document.activeElement?.closest('.nb-flip-leaf-right')), 'Typing caret follows the carried text');
      await page.keyboard.press('Control+z');
      await page.waitForFunction(async bookId => {
        const rows = await (await import('/src/data/pages.ts')).listPages(bookId);
        const details = rows.flatMap(row => row.doc.content.filter(node => node.type === 'details'));
        return details.length === 1 && !JSON.stringify(rows).includes('word220') && JSON.stringify(rows).includes('Beginning ');
      }, fixture.bookId);
      interaction = true;
    } else if (preserved && fits && fillsFirst) {
      const continuation = page.locator('.nb-flip-leaf-right [data-type=details]').first();
      const button = continuation.locator(':scope > button');
      await button.click();
      await page.waitForFunction(() => !document.querySelector('.nb-flip-leaf-right [data-type=details]')?.classList.contains('is-open'));
      await button.click();
      await page.waitForFunction(() => document.querySelector('.nb-flip-leaf-right [data-type=details]')?.classList.contains('is-open'));
      const line = continuation.locator('[data-type=detailsContent] p').last();
      await line.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' EDITED');
      await page.waitForFunction(async bookId => {
        const { listPages } = await import('/src/data/pages.ts');
        return JSON.stringify(await listPages(bookId)).includes('EDITED');
      }, fixture.bookId);
      await page.keyboard.press('Control+z');
      await page.waitForFunction(async bookId => {
        const { listPages } = await import('/src/data/pages.ts');
        return !JSON.stringify(await listPages(bookId)).includes('EDITED');
      }, fixture.bookId);
      const snapshot = await page.evaluate(async bookId => (await import('/src/data/pages.ts')).listPages(bookId), fixture.bookId);
      await page.reload();
      await page.waitForFunction(() => !!globalThis.__shelfWorld?.ready);
      await page.evaluate(() => globalThis.__shelfWorld.ready);
      await page.evaluate(async bookId => (await import('/src/state/app.ts')).appState.openBook(bookId), fixture.bookId);
      await page.locator('.nb-flip-leaf-right [data-type=details].is-open').waitFor();
      const reloaded = await page.evaluate(async bookId => (await import('/src/data/pages.ts')).listPages(bookId), fixture.bookId);
      assert.deepEqual(reloaded.map(row => row.doc), snapshot.map(row => row.doc), 'Reopening must preserve the paginated dropdowns');
      interaction = true;
    }
    report.push({ scenario, failure, preserved, fits, fillsFirst, interaction, ...state });
    await context.close();
  }
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.map(({ scenario, failure, preserved, fits, fillsFirst, interaction }) => ({ scenario, failure, preserved, fits, fillsFirst, interaction }))));
  assert(report.every(item => !item.failure && item.preserved && item.fits && item.fillsFirst && item.interaction), 'Dropdowns must fill available space, carry all body text, and remain editable after reload');
} finally { await browser.close(); }
