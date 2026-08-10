/**
 * Read-only integration refutation for the Welcome binding and book surfaces.
 *
 * Runs against an already-running dev server. The browser stub lives in the
 * temporary Chromium profile, so the owner's desktop database is never read
 * or changed. Only screenshots/report files under shots-now/out are written.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = process.argv.find((value) => value.startsWith('--url='));
const base = arg?.slice('--url='.length) ?? 'http://127.0.0.1:1420';
const out = 'shots-now/out/integration-welcome';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1500, height: 980 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(120_000);

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

const report = {
  ok: false,
  url: base,
  welcome: null,
  wrapper: {},
  settings: {},
  libraryStudio: {},
  bookStudio: {},
  screenshots: [],
  pageErrors,
};

const fail = (message) => {
  throw new Error(message);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};
const shot = async (name, options = {}) => {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path, caret: 'hide', timeout: 180_000, ...options });
  report.screenshots.push(path);
  return path;
};
const clipAround = (rect, padX, padY) => ({
  x: Math.max(0, Math.floor(rect.x - padX)),
  y: Math.max(0, Math.floor(rect.y - padY)),
  width: Math.min(
    1500 - Math.max(0, Math.floor(rect.x - padX)),
    Math.ceil(rect.width + padX * 2),
  ),
  height: Math.min(
    980 - Math.max(0, Math.floor(rect.y - padY)),
    Math.ceil(rect.height + padY * 2),
  ),
});
const dismissTour = async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const skip = page.getByText('skip the tour', { exact: false });
    if ((await skip.count()) === 0) break;
    await skip.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(350);
  }
  await page.keyboard.press('Escape').catch(() => {});
};
const waitForShelf = async () => {
  await page.waitForFunction(
    () =>
      globalThis.__shelfWorld !== undefined &&
      typeof globalThis.__shelfVisibleBooks === 'function' &&
      globalThis.__shelfVisibleBooks().length > 0,
    null,
    { polling: 300 },
  );
  await page.evaluate(async () => {
    await globalThis.__shelfWorld.ready;
    await globalThis.__shelfWhenSpinesReady?.(true);
  });
};
const welcomeState = async () => page.evaluate(async () => {
  const book = (globalThis.__shelfVisibleBooks?.() ?? []).find((item) =>
    item.title.toLowerCase().startsWith('welcome'),
  );
  if (!book) return null;
  const meta = globalThis.__shelfBookMeta?.(book.id) ?? null;
  const binding = globalThis.__shelfBinding?.(book.id) ?? null;
  const rect = globalThis.__shelfSpineRect?.(book.id) ?? null;
  const designModule = await import('/src/art/bookDesign.ts');
  const spineModule = await import('/src/art/spines.ts');
  const flatModule = await import('/src/art/flat.ts');
  const preset = typeof binding === 'string' ? designModule.bookPreset(binding) : null;
  const style = meta?.style ?? null;
  return {
    id: book.id,
    title: book.title,
    binding,
    style,
    rect,
    shape: preset?.shape ?? null,
    material: preset?.material ?? null,
    clothPair: typeof style?.pigment === 'number'
      ? flatModule.CLOTHS[spineModule.clothForPalette(style.pigment)] ?? null
      : null,
  };
});
const wrapperState = async () => page.locator('[data-testid="pulled-book"]').evaluate((node) => {
  const style = getComputedStyle(node);
  const canvas = node.querySelector('.pulled-book__cover');
  const canvasStyle = canvas ? getComputedStyle(canvas) : null;
  const coverBackground = canvasStyle?.backgroundImage ?? '';
  return {
    className: node.className,
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    borderTopWidth: style.borderTopWidth,
    borderRightWidth: style.borderRightWidth,
    borderBottomWidth: style.borderBottomWidth,
    borderLeftWidth: style.borderLeftWidth,
    borderTopStyle: style.borderTopStyle,
    borderRightStyle: style.borderRightStyle,
    borderBottomStyle: style.borderBottomStyle,
    borderLeftStyle: style.borderLeftStyle,
    childTags: [...node.children].map((child) => child.tagName.toLowerCase()),
    coverHasPaintedBackground: coverBackground.startsWith('url('),
    coverBackgroundPrefix: coverBackground.slice(0, 40),
  };
});
const assertTransparentWrapper = (state, stage) => {
  check(
    state.backgroundColor === 'rgba(0, 0, 0, 0)' || state.backgroundColor === 'transparent',
    `${stage}: pulled-book wrapper has ${state.backgroundColor} background`,
  );
  check(state.backgroundImage === 'none', `${stage}: wrapper has a background image`);
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    check(state[`border${side}Width`] === '0px', `${stage}: ${side} border is not zero`);
  }
  check(
    state.coverHasPaintedBackground === true,
    `${stage}: painted cover canvas is missing`,
  );
};
const storedWelcomePreference = async () => page.evaluate(() => {
  const raw = localStorage.getItem('notebook.stubdb.v1');
  if (raw === null) return null;
  const tables = JSON.parse(raw);
  const row = Array.isArray(tables.settings)
    ? tables.settings.find((candidate) => candidate?.key === 'app')
    : null;
  if (!row || typeof row.value !== 'string') return null;
  return JSON.parse(row.value).refreshWelcomeBookOnUpdate;
});

try {
  // Establish a genuinely clean browser stub. This context is disposable and
  // separate from the owner's Tauri SQLite library.
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForShelf();
  await dismissTour();
  await page.waitForTimeout(900);

  const welcome = await welcomeState();
  check(welcome !== null, 'fresh browser stub did not seed a Welcome book');
  check(welcome.binding === 'plain-cloth', `Welcome binding is ${String(welcome.binding)}`);
  check(welcome.shape === 'square', `Welcome shape is ${String(welcome.shape)}`);
  check(welcome.material === 'smooth-cloth', `Welcome material is ${String(welcome.material)}`);
  check(welcome.style?.pigment === 20, `Welcome pigment is ${String(welcome.style?.pigment)}`);
  check(welcome.style?.raisedBands === 2, `Welcome cords are ${String(welcome.style?.raisedBands)}`);
  check(welcome.style?.ornament === 20, `Welcome spine emblem is ${String(welcome.style?.ornament)}`);
  check(welcome.style?.coverMedallion === 20, `Welcome cover emblem is ${String(welcome.style?.coverMedallion)}`);
  check(welcome.style?.headTail === false, 'Welcome unexpectedly has an endband mark');
  check(welcome.style?.charm === 'none', `Welcome charm is ${String(welcome.style?.charm)}`);
  check(welcome.style?.cornerProtectors === false, 'Welcome corner protectors are enabled');
  check(welcome.style?.insetPlate === false, 'Welcome inset plate is enabled');
  check(welcome.rect !== null, 'Welcome spine has no applied shelf rect');
  report.welcome = welcome;

  await shot('01-welcome-shelf');
  await shot('02-welcome-spine-true', { clip: clipAround(welcome.rect, 24, 18) });

  // The outbound cover exists for only ~600ms. Capture it while the hinge and
  // arc are genuinely in flight, then again after its elastic settle.
  await page.evaluate((id) => globalThis.__shelfPullOut(id), welcome.id);
  const pulled = page.locator('[data-testid="pulled-book"]');
  await pulled.waitFor({ state: 'visible' });
  await page.waitForTimeout(145);
  report.wrapper.midFlight = await wrapperState();
  assertTransparentWrapper(report.wrapper.midFlight, 'mid-flight');
  await shot('03-welcome-mid-flight');

  await page.waitForSelector('[data-testid="pulled-book"].is-held', { timeout: 30_000 });
  await page.waitForTimeout(250);
  report.wrapper.held = await wrapperState();
  assertTransparentWrapper(report.wrapper.held, 'held');
  await shot('04-welcome-held');
  const heldBox = await pulled.boundingBox();
  check(heldBox !== null, 'held cover has no bounding box');
  await shot('05-welcome-held-cover', { clip: clipAround(heldBox, 38, 28) });

  // A real pointer carry, held down for the screenshot. Moving upward keeps
  // the whole cover visible and avoids conflating the case drop target with
  // the wrapper check.
  const startX = heldBox.x + heldBox.width * 0.55;
  const startY = heldBox.y + heldBox.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(Math.min(1420, startX + 190), Math.max(75, startY - 95), { steps: 8 });
  await page.waitForSelector('[data-testid="pulled-book"].is-carried');
  report.wrapper.carried = await wrapperState();
  assertTransparentWrapper(report.wrapper.carried, 'carried');
  await shot('06-welcome-carried');
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await pulled.waitFor({ state: 'detached', timeout: 30_000 }).catch(async () => {
    await pulled.waitFor({ state: 'hidden', timeout: 30_000 });
  });

  // Fresh stub: the opt-in must start off. Turn it on through the real UI,
  // read the stub's persisted JSON, reload, and prove the checked state returns.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settingsDialog.waitFor({ state: 'visible' });
  await page.getByPlaceholder('search the settings…').fill('welcome');
  const welcomeToggle = page.getByRole('switch', {
    name: 'replace edited Welcome book on updates',
    exact: true,
  });
  await welcomeToggle.waitFor({ state: 'visible' });
  check((await welcomeToggle.getAttribute('aria-checked')) === 'false', 'Welcome update setting is not default-off');
  const settingsRowText = await welcomeToggle.evaluate((node) => {
    const row = node.closest('.nbs-row');
    if (!(row instanceof HTMLElement)) throw new Error('Welcome toggle has no settings row');
    return row.innerText;
  });
  check(settingsRowText.includes('keep Welcome book current'), 'Welcome update row label is missing');
  check(
    settingsRowText.includes('replace its pages and binding—even if you edited them'),
    'Welcome update consequence hint is missing',
  );
  report.settings.defaultOff = true;
  report.settings.rowText = settingsRowText;
  await shot('07-settings-default-off');

  await welcomeToggle.click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('notebook.stubdb.v1');
    if (raw === null) return false;
    const tables = JSON.parse(raw);
    const row = tables.settings?.find?.((candidate) => candidate?.key === 'app');
    return row ? JSON.parse(row.value).refreshWelcomeBookOnUpdate === true : false;
  });
  report.settings.persistedRawAfterOn = await storedWelcomePreference();
  check(report.settings.persistedRawAfterOn === true, 'browser stub did not persist Welcome update=true');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForShelf();
  await dismissTour();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'visible' });
  await page.getByPlaceholder('search the settings…').fill('welcome');
  const persistedToggle = page.getByRole('switch', {
    name: 'replace edited Welcome book on updates',
    exact: true,
  });
  await persistedToggle.waitFor({ state: 'visible' });
  await page.waitForTimeout(750);
  check((await persistedToggle.getAttribute('aria-checked')) === 'true', 'Welcome update setting did not survive reload');
  report.settings.survivedReload = true;
  await shot('08-settings-persisted-on');

  // Restore the clean-stub default before checking the remaining panels.
  await persistedToggle.click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('notebook.stubdb.v1');
    if (raw === null) return false;
    const tables = JSON.parse(raw);
    const row = tables.settings?.find?.((candidate) => candidate?.key === 'app');
    return row ? JSON.parse(row.value).refreshWelcomeBookOnUpdate === false : false;
  });
  report.settings.restoredOff = (await storedWelcomePreference()) === false;
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await settingsDialog.waitFor({ state: 'hidden' });

  // The BOOK reset must not amputate the independent room vocabulary.
  await page.getByRole('button', { name: 'Library studio', exact: true }).click();
  const libraryDialog = page.getByRole('dialog', { name: 'Library studio', exact: true });
  await libraryDialog.waitFor({ state: 'visible' });
  const buildGroup = page.getByRole('group', { name: 'Bookcase build', exact: true });
  const patternGroup = page.getByRole('group', { name: 'Timber pattern', exact: true });
  const wallpaperGroup = page.getByRole('group', { name: 'Wallpaper', exact: true });
  check((await buildGroup.count()) === 1, 'Bookcase build picker is not reachable');
  check((await patternGroup.count()) === 1, 'Timber pattern picker is not reachable');
  check((await wallpaperGroup.count()) === 1, 'Wallpaper picker is not reachable');
  report.libraryStudio = {
    bookcaseBuildButtons: await buildGroup.getByRole('button').count(),
    timberPatternButtons: await patternGroup.getByRole('button').count(),
    wallpaperButtons: await wallpaperGroup.getByRole('button').count(),
  };
  await buildGroup.scrollIntoViewIfNeeded();
  await shot('09-library-studio-bookcase');
  await wallpaperGroup.scrollIntoViewIfNeeded();
  await shot('10-library-studio-wallpaper');
  await page.getByRole('button', { name: 'Close Library studio', exact: true }).click();
  await libraryDialog.waitFor({ state: 'hidden' });

  // Open the book-specific Studio through the app's canonical reader route,
  // then press the real Customize button. The Pixi context-menu verb is
  // deliberately tier-0 only; a synthetic contextmenu can therefore miss even
  // when __shelfSpineRect proves the book is painted. The direct state route
  // is also the path used by quick switcher/tray/import and avoids asking this
  // book-surface gate to depend on the unrelated browser sound stub.
  const afterReloadWelcome = await welcomeState();
  check(afterReloadWelcome?.rect !== null, 'Welcome spine disappeared after settings reload');
  await page.evaluate(async (bookId) => {
    const { appState } = await import('/src/state/app.ts');
    appState.openBook(bookId);
  }, afterReloadWelcome.id);
  await page.waitForSelector('.nb-rail', { state: 'visible' });
  const customizeBook = page.getByRole('button', { name: /Customize this book/i });
  await customizeBook.waitFor({ state: 'visible' });
  await customizeBook.click();
  const bookStudio = page.locator('.nb-book-studio');
  await bookStudio.waitFor({ state: 'visible' });
  await page.waitForTimeout(900);

  const controls = await bookStudio.locator('button, input, select, [role="switch"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.getAttribute('aria-label') ?? '',
      text: node.textContent?.trim() ?? '',
      role: node.getAttribute('role') ?? node.tagName.toLowerCase(),
    })),
  );
  const forbiddenControls = controls.filter(({ label, text }) =>
    /charm|tassel|pressed[ -]flower|wax[ -]seal|corner protector|inset plate|hardware/i.test(`${label} ${text}`),
  );
  check(forbiddenControls.length === 0, `retired Book Studio controls remain: ${JSON.stringify(forbiddenControls)}`);
  const studioText = (await bookStudio.innerText()).toLowerCase();
  check(!studioText.includes('spine title'), 'Book Studio still exposes a spine-title control');
  check(studioText.includes('cover title'), 'Book Studio lost its cover-title controls');
  check((await page.getByRole('group', { name: 'Book emblem', exact: true }).count()) === 1, 'Unified emblem picker is missing');
  check((await page.getByRole('group', { name: 'Cover frame', exact: true }).count()) === 1, 'Cover frame picker is missing');
  check((await page.getByRole('group', { name: 'Edge treatment', exact: true }).count()) === 1, 'Page-edge picker is missing');
  const surpriseLockIds = await bookStudio.locator('[data-surprise-lock]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-surprise-lock')),
  );
  check(surpriseLockIds.length === 24, `Book Studio exposes ${surpriseLockIds.length} Surprise locks instead of 24`);
  check(new Set(surpriseLockIds).size === 24, 'Book Studio repeats a Surprise lock id');
  report.bookStudio = {
    ...report.bookStudio,
    route: 'canonical appState reader route -> reader Customize this book',
    controlCount: controls.length,
    forbiddenControls,
    hasSpineTitle: false,
    hasCoverTitle: true,
    surpriseLockCount: surpriseLockIds.length,
    surpriseLockIds,
    unifiedEmblem: true,
    coverFrame: true,
    pageEdges: true,
  };
  await shot('11-book-studio');

  check(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);

  report.ok = true;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await browser.close();
}
