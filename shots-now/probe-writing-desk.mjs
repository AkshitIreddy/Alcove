/**
 * Live gate for the open-book writing desk: persisted colour, camera-only
 * wheel zoom, and the arrow-only back control. Runs through the real BookView.
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const sabotage = process.argv.includes('--sabotage');
const narrow = process.argv.includes('--narrow');
const OUT = sabotage
  ? 'qa/writing-desk/sabotage'
  : narrow
    ? 'qa/writing-desk/narrow'
    : 'qa/writing-desk';
const VIEWPORT = narrow ? { width: 1280, height: 800 } : { width: 1706, height: 1066 };
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
const skip = page.getByText('skip the tour', { exact: false }).first();
if (await skip.count()) await skip.click({ force: true }).catch(() => {});
await page.keyboard.press('Escape').catch(() => {});

const bookId = await page.evaluate(async () => {
  const books = await import('/src/data/books.ts');
  const pages = await import('/src/data/pages.ts');
  const id = `qa-writing-desk-${Date.now()}`;
  await books.createBook({
    id,
    title: 'The Writing Desk',
    floor: 0,
    slot: 48,
    spineSeed: 7181,
  });
  const paragraph = (text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });
  await pages.createPage({
    bookId: id,
    ord: 0,
    doc: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A room for the book' }] },
        paragraph('The desk may change colour and the bound book may move closer, but these words keep their exact page geometry.'),
        paragraph('Wheel over the field, not the paper, to resize the whole book.'),
      ],
    },
  });
  await pages.createPage({
    bookId: id,
    ord: 1,
    doc: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Camera, not layout' }] },
        paragraph('No block is allowed to move to another page when this camera changes.'),
      ],
    },
  });
  const world = globalThis.__shelfWorld;
  if (world === undefined || typeof world.refreshData !== 'function') {
    throw new Error('live shelf QA bridge was unavailable');
  }
  await world.refreshData();
  globalThis.__shelfPullOut(id);
  return id;
});

await page.getByRole('button', { name: 'Open The Writing Desk' }).click();
await page.waitForSelector('.nb-book-view .nb-book-cover');
await page.waitForSelector('.nb-flip-leaf-left .nb-prose');
await page.waitForTimeout(900);

if (sabotage) {
  await page.addStyleTag({
    content: `
      .nb-book-view { --nb-writing-desk: #fff !important; }
      .nb-back-button::after { content: 'back to shelf'; font-size: 14px; }
    `,
  });
}

async function snapshot() {
  return page.evaluate(async (id) => {
    const pages = await import('/src/data/pages.ts');
    const stored = await pages.listPages(id);
    const required = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`);
      return element;
    };
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const view = required('.nb-book-view');
    const frame = required('.nb-spread-fit-frame');
    const cover = required('.nb-book-cover');
    const back = required('.nb-back-button');
    const blocks = Array.from(
      document.querySelectorAll('.nb-flip-leaf > .nb-sheet-paper .nb-prose > *'),
    ).map((block) => ({
      text: block.textContent ?? '',
      left: block.offsetLeft,
      top: block.offsetTop,
      width: block.offsetWidth,
      height: block.offsetHeight,
    }));
    return {
      zoom: Number(view.dataset.deskZoom ?? 1),
      wheelArmed: view.dataset.deskWheelArmed === 'true',
      focusMode: view.dataset.focusMode,
      openPanels: Array.from(document.querySelectorAll('.nb-rail-panel[aria-hidden="false"]'))
        .map((panel) => panel.getAttribute('aria-label')),
      desk: getComputedStyle(view).backgroundColor,
      frameLayout: { width: frame.offsetWidth, height: frame.offsetHeight },
      coverLayout: { width: cover.offsetWidth, height: cover.offsetHeight },
      coverDrawn: rect(cover),
      blocks,
      stored: stored.map((row) => ({ id: row.id, ord: row.ord, doc: row.doc })),
      back: {
        rect: rect(back),
        text: back.textContent?.trim() ?? '',
        aria: back.getAttribute('aria-label') ?? '',
        pseudo: getComputedStyle(back, '::after').content,
        color: getComputedStyle(back.querySelector('svg') ?? back).color,
      },
    };
  }, bookId);
}

const baseline = await snapshot();

await page.locator('.nbs-gear-button').click();
const settingsDialog = page.getByRole('dialog', { name: /settings/i });
await settingsDialog.waitFor({ state: 'visible' });
const settingsSearch = settingsDialog.getByPlaceholder('search the settings…');
await settingsSearch.fill('writing desk');
const searchedDeskButtons = settingsDialog.getByRole('button', { name: / writing desk$/ });
await searchedDeskButtons.first().waitFor();
await page.waitForFunction(() =>
  document.querySelectorAll('#nbs-writing-desks button[aria-label$=" writing desk"]').length === 25
);
const settingsAllCount = await searchedDeskButtons.count();
await page.screenshot({ path: `${OUT}/01-settings-all-desks.png`, caret: 'hide' });

await settingsSearch.fill('');
const showAllDesks = settingsDialog.locator('button[aria-controls="nbs-writing-desks"]');
await showAllDesks.scrollIntoViewIfNeeded();
const settingsDisclosureVisible = (await showAllDesks.count()) === 1;
await page.screenshot({ path: `${OUT}/02-settings-eight-first.png`, caret: 'hide' });
await showAllDesks.click();
const settingsDeskRegion = settingsDialog.locator('#nbs-writing-desks');
await settingsDeskRegion.getByRole('button', { name: 'midnight writing desk' }).click();
if (sabotage) {
  await page.waitForTimeout(300);
} else {
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.nb-book-view')).backgroundColor === 'rgb(190, 199, 227)'
  );
}
await page.screenshot({ path: `${OUT}/03-settings-midnight.png`, caret: 'hide' });
await settingsDialog.getByRole('button', { name: 'Close settings' }).click();
await settingsDialog.waitFor({ state: 'hidden' });
await page.waitForTimeout(350);
const midnight = await snapshot();
await page.screenshot({ path: `${OUT}/04-midnight-desk.png`, caret: 'hide' });

await page.locator('.nbs-gear-button').click();
await settingsDialog.waitFor({ state: 'visible' });
await settingsSearch.fill('writing desk');
await settingsDialog.getByRole('button', { name: 'coral writing desk' }).click();
if (sabotage) {
  await page.waitForTimeout(300);
} else {
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.nb-book-view')).backgroundColor === 'rgb(245, 193, 184)'
  );
}
await page.screenshot({ path: `${OUT}/05-settings-coral.png`, caret: 'hide' });
await settingsDialog.getByRole('button', { name: 'Close settings' }).click();
await settingsDialog.waitFor({ state: 'hidden' });
const coral = await snapshot();
await page.screenshot({ path: `${OUT}/06-coral-desk.png`, caret: 'hide' });

const back = page.locator('.nb-back-button');
const backBefore = await back.boundingBox();
await back.hover();
await page.waitForTimeout(250);
const backAfter = await back.boundingBox();
const hovered = await snapshot();
await page.screenshot({ path: `${OUT}/07-back-hover.png`, caret: 'hide' });

const deskPoint = await page.evaluate(() => {
  const view = document.querySelector('.nb-book-view');
  const cover = document.querySelector('.nb-book-cover');
  if (!(view instanceof HTMLElement) || !(cover instanceof HTMLElement)) return null;
  const v = view.getBoundingClientRect();
  const c = cover.getBoundingClientRect();
  const candidates = [
    { x: (v.left + v.right) / 2, y: v.bottom - 18 },
    { x: v.left + 72, y: v.bottom - 18 },
    { x: v.right - 18, y: (v.top + v.bottom) / 2 },
  ];
  return candidates.find(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return hit instanceof Element &&
      hit.closest('.nb-book-view') &&
      !hit.closest('.nb-spread-fit-frame, .nb-book-cover, .nb-rail, .nb-rail-panel, .nb-back-button, dialog, [role="dialog"], button, input, textarea, select, [contenteditable="true"]');
  }) ?? null;
});
if (deskPoint === null) throw new Error('no empty writing-desk point was available');
await page.mouse.move(deskPoint.x, deskPoint.y);
await page.mouse.wheel(0, -180);
await page.waitForTimeout(180);
const hoverWheel = await snapshot();

await page.mouse.click(deskPoint.x, deskPoint.y);
const clickedDesk = await snapshot();
if (!clickedDesk.wheelArmed) {
  throw new Error(`explicit desk click did not arm wheel zoom at ${JSON.stringify(deskPoint)}`);
}
await page.waitForTimeout(1_020);
const unusedClickExpired = await snapshot();
await page.mouse.wheel(0, -180);
await page.waitForTimeout(180);
const unusedExpiredWheel = await snapshot();

await page.mouse.click(deskPoint.x, deskPoint.y);
await page.mouse.wheel(0, -180);
await page.waitForFunction(() => Number(document.querySelector('.nb-book-view')?.dataset.deskZoom) > 1);
const zoomed = await snapshot();
await page.screenshot({ path: `${OUT}/08-desk-zoom.png`, caret: 'hide' });

await page.waitForTimeout(760);
const expiredDesk = await snapshot();
await page.mouse.wheel(0, -180);
await page.waitForTimeout(180);
const expiredWheel = await snapshot();

await page.mouse.click(deskPoint.x, deskPoint.y);
await page.keyboard.down('Shift');
await page.keyboard.up('Shift');
const keyboardCancelled = await snapshot();
await page.mouse.wheel(0, -180);
await page.waitForTimeout(180);
const keyboardWheel = await snapshot();

await page.mouse.click(deskPoint.x, deskPoint.y);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
const blurCancelled = await snapshot();
await page.mouse.wheel(0, -180);
await page.waitForTimeout(180);
const blurWheel = await snapshot();

await page.mouse.click(deskPoint.x, deskPoint.y);
await page.evaluate(({ x, y }) => {
  document.elementFromPoint(x, y)?.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -180,
    }),
  );
}, deskPoint);
const modifierWheel = await snapshot();

await page.mouse.click(deskPoint.x, deskPoint.y);
await page.mouse.move(deskPoint.x + 24, deskPoint.y);
await page.waitForTimeout(80);
const movedAfterClick = await snapshot();
await page.mouse.wheel(0, -180);
await page.waitForTimeout(180);
const movedWheel = await snapshot();

const coverBox = await page.locator('.nb-book-cover').boundingBox();
if (coverBox === null) throw new Error('book cover was not measurable');
await page.mouse.click(deskPoint.x, deskPoint.y);
await page.mouse.move(coverBox.x + coverBox.width / 2, coverBox.y + coverBox.height / 2);
await page.mouse.wheel(0, -180);
await page.waitForTimeout(250);
const paperWheel = await snapshot();

await page.mouse.click(deskPoint.x, deskPoint.y);
const agentButton = page.getByRole('button', { name: /^AI agent —/ });
await agentButton.click();
const agentPanel = page.locator('.nb-rail-panel.is-ai-agent[aria-hidden="false"]');
await agentPanel.waitFor({ state: 'visible' });
const panelOpened = await snapshot();
const agentPanelBox = await agentPanel.boundingBox();
if (agentPanelBox === null) throw new Error('AI agent panel was not measurable');
await page.mouse.move(
  agentPanelBox.x + agentPanelBox.width / 2,
  agentPanelBox.y + agentPanelBox.height * 0.65,
);
await page.mouse.wheel(0, 320);
await page.mouse.wheel(0, -320);
await page.waitForTimeout(180);
const panelWheel = await snapshot();
await page.screenshot({ path: `${OUT}/09-agent-panel-wheel.png`, caret: 'hide' });
await agentPanel.getByRole('button', { name: 'Close AI agent' }).click();
await agentPanel.waitFor({ state: 'hidden' });

await page.mouse.move(deskPoint.x, deskPoint.y);
await page.mouse.wheel(0, 180);
await page.waitForTimeout(180);
const hoverAfterPanel = await snapshot();

await page.waitForFunction(() => globalThis.__nbTaste !== undefined);
await page.evaluate(() => globalThis.__nbTaste.open());
const deskQuestion = page.getByRole('tab', { name: 'What should sit behind the open book?' });
await deskQuestion.click();
await page.getByRole('heading', { name: 'What should sit behind the open book?' }).waitFor();
const onboardingInitialCount = await page.locator('.nbq-desk-art').count();
await page.screenshot({ path: `${OUT}/10-onboarding-eight-first.png`, caret: 'hide' });
const onboardingMore = page.getByRole('button', { name: 'writing desks: show 17 more' });
await onboardingMore.click();
await page.waitForFunction(() => document.querySelectorAll('.nbq-desk-art').length === 25);
await page.screenshot({ path: `${OUT}/11-onboarding-all-desks.png`, caret: 'hide' });
await page.locator('.nbq-sheet').evaluate((sheet) => {
  sheet.scrollTop = sheet.scrollHeight;
});
await page.waitForFunction(() => {
  const sheet = document.querySelector('.nbq-sheet');
  return sheet instanceof HTMLElement && sheet.scrollTop > 0;
});
await page.screenshot({ path: `${OUT}/12-onboarding-all-desks-lower.png`, caret: 'hide' });

const layoutKey = (value) => JSON.stringify({
  stored: value.stored,
  frameLayout: value.frameLayout,
  coverLayout: value.coverLayout,
  blocks: value.blocks,
});
const sameBox = (a, b) =>
  a !== null && b !== null &&
  Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01;
const rgb = (value) => (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);
const luminance = (value) => {
  const channels = rgb(value).map((channel) => {
    const linear = channel / 255;
    return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const checks = {
  settingsShowsAllTwentyFive: settingsAllCount === 25,
  settingsKeepsEightFirst: settingsDisclosureVisible,
  midnightApplied: midnight.desk === 'rgb(190, 199, 227)',
  darkDeskArrowLegible: contrast(midnight.desk, midnight.back.color) >= 3,
  coralApplied: coral.desk === 'rgb(245, 193, 184)',
  authoredDeskVisible: coral.desk !== 'rgb(255, 255, 255)',
  backArrowOnly: hovered.back.text === '' && hovered.back.pseudo === 'none',
  backAccessible: hovered.back.aria.startsWith('back to shelf'),
  backDoesNotGrow: sameBox(backBefore, backAfter),
  hoverAloneNeverArmsOrZooms:
    hoverWheel.zoom === coral.zoom && !hoverWheel.wheelArmed,
  explicitDeskClickArms:
    clickedDesk.zoom === coral.zoom && clickedDesk.wheelArmed,
  unusedClickAuthorizationExpires:
    !unusedClickExpired.wheelArmed &&
    unusedExpiredWheel.zoom === unusedClickExpired.zoom,
  immediateDeskWheelZoomsBook:
    zoomed.zoom > coral.zoom && zoomed.coverDrawn.width > coral.coverDrawn.width,
  tokenExpiresAfterGesture:
    !expiredDesk.wheelArmed && expiredWheel.zoom === expiredDesk.zoom,
  keyboardActivityCancelsToken:
    !keyboardCancelled.wheelArmed && keyboardWheel.zoom === keyboardCancelled.zoom,
  windowBlurCancelsToken:
    !blurCancelled.wheelArmed && blurWheel.zoom === blurCancelled.zoom,
  modifierWheelCancelsWithoutZoom:
    !modifierWheel.wheelArmed && modifierWheel.zoom === blurWheel.zoom,
  pointerTravelCancelsToken:
    !movedAfterClick.wheelArmed && movedWheel.zoom === movedAfterClick.zoom,
  paperTravelAndWheelCancelToken:
    !paperWheel.wheelArmed && paperWheel.zoom === movedWheel.zoom,
  openingPanelCancelsToken:
    !panelOpened.wheelArmed,
  panelWheelNeverZoomsBook:
    panelWheel.zoom === panelOpened.zoom && !panelWheel.wheelArmed,
  panelActivityDoesNotLeaveLatentToken:
    hoverAfterPanel.zoom === panelWheel.zoom && !hoverAfterPanel.wheelArmed,
  canonicalLayoutUnchanged:
    layoutKey(baseline) === layoutKey(coral) &&
    layoutKey(coral) === layoutKey(zoomed) &&
    layoutKey(zoomed) === layoutKey(expiredWheel) &&
    layoutKey(expiredWheel) === layoutKey(keyboardWheel) &&
    layoutKey(keyboardWheel) === layoutKey(blurWheel) &&
    layoutKey(blurWheel) === layoutKey(modifierWheel) &&
    layoutKey(modifierWheel) === layoutKey(movedWheel) &&
    layoutKey(movedWheel) === layoutKey(paperWheel) &&
    layoutKey(paperWheel) === layoutKey(panelWheel),
  onboardingShowsEightThenAll:
    onboardingInitialCount === 8 &&
    (await page.locator('.nbq-desk-art').count()) === 25 &&
    (await page.getByRole('button', { name: 'writing desks: show fewer' }).count()) === 1,
  noConsoleErrors: consoleErrors.length === 0,
  noPageErrors: pageErrors.length === 0,
};
const report = {
  ok: Object.values(checks).every(Boolean),
  sabotage,
  narrow,
  checks,
  baseline,
  midnight,
  coral,
  hovered,
  hoverWheel,
  clickedDesk,
  unusedClickExpired,
  unusedExpiredWheel,
  zoomed,
  expiredDesk,
  expiredWheel,
  keyboardCancelled,
  keyboardWheel,
  blurCancelled,
  blurWheel,
  modifierWheel,
  movedAfterClick,
  movedWheel,
  paperWheel,
  panelOpened,
  panelWheel,
  hoverAfterPanel,
  consoleErrors,
  pageErrors,
};
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();

if (sabotage && !report.ok) {
  console.log('writing desk: GATE ALIVE · forced white desk/back label rejected');
} else if (!report.ok) {
  console.error(`writing desk: FAILED\n${JSON.stringify(checks, null, 2)}`);
  process.exitCode = 1;
} else if (sabotage) {
  console.error('writing desk: GATE INERT');
  process.exitCode = 2;
} else {
  console.log(`writing desk: PASS · zoom ${coral.zoom}→${zoomed.zoom}`);
}
