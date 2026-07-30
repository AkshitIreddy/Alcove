/**
 * Design-audit regressions (docs/design/ui-audit.md).
 *
 * These lock in the specific defects the professional UI/UX pass found, so a
 * later refactor cannot quietly reintroduce them. They assert MEASURED
 * properties — computed contrast ratios, computed radii, laid-out geometry —
 * rather than pixel snapshots, so they stay green across art changes and are
 * immune to SwiftShader's throttled rAF.
 */
import { expect, test, type Page } from 'playwright/test';
import { openBookView } from './helpers';

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** WCAG 2.1 contrast between two computed CSS colors, evaluated in-page. */
const CONTRAST_FN = `
  (fg, bg) => {
    const parse = (c) => {
      const m = c.match(/[\\d.]+/g);
      if (!m) return [0, 0, 0, 1];
      return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
    };
    const [fr, fg2, fb, fa] = parse(fg);
    const [br, bg2, bb] = parse(bg);
    // Flatten any foreground alpha onto the background before measuring.
    const mix = (f, b) => f * fa + b * (1 - fa);
    const chan = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (r, g, b) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
    const l1 = lum(mix(fr, br), mix(fg2, bg2), mix(fb, bb));
    const l2 = lum(br, bg2, bb);
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  }
`;

/** Nearest ancestor (or self) that paints a non-transparent background. */
const PAINTED_BG_FN = `
  (el) => {
    let node = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\\(0, 0, 0, 0\\)/.test(bg)) return bg;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }
`;

async function openSettings(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.nbs-gear-button').click();
  await expect(page.locator('.nbs-sheet')).toBeVisible({ timeout: 30_000 });
  // GSAP slides the sheet in; wait until it has actually arrived on-screen.
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => document.querySelector('.nbs-sheet')!.getBoundingClientRect().right,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const r = document.querySelector('.nbs-sheet')!.getBoundingClientRect();
          return Math.round(r.right - window.innerWidth);
        }),
      { timeout: 15_000, message: 'settings sheet never finished sliding in' },
    )
    .toBeLessThanOrEqual(1);
}

/* -------------------------------------------------------------------------- */
/* contrast                                                                    */
/* -------------------------------------------------------------------------- */

test('secondary ink clears WCAG AA on every theme (audit 2, 3, 5)', async ({
  page,
}) => {
  await page.goto('/');

  for (const theme of ['parchment', 'pastel', 'botanical', 'night'] as const) {
    const ratios = await page.evaluate(
      ([themeName, contrastSrc]) => {
        const root = document.documentElement;
        const previous = root.getAttribute('data-theme');
        root.setAttribute('data-theme', themeName);
        const contrast = eval(contrastSrc) as (a: string, b: string) => number;
        const read = (name: string): string =>
          getComputedStyle(root).getPropertyValue(name).trim();

        // Probe elements so the browser resolves the tokens for us.
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(probe);
        const resolve = (value: string): string => {
          probe.style.color = value;
          return getComputedStyle(probe).color;
        };
        const grounds = {
          aged: resolve(read('--paper-aged')),
          cream: resolve(read('--paper-cream')),
        };
        const inks = {
          sepiaSoft: resolve(read('--ink-sepia-soft')),
          graphiteSoft: resolve(read('--ink-graphite-soft')),
          accent: resolve(read('--ink-accent')),
        };
        probe.remove();
        if (previous === null) root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', previous);

        const out: Record<string, number> = {};
        for (const [inkName, ink] of Object.entries(inks)) {
          for (const [groundName, ground] of Object.entries(grounds)) {
            out[`${inkName}/${groundName}`] = contrast(ink, ground);
          }
        }
        return out;
      },
      [theme, CONTRAST_FN] as const,
    );

    for (const [pair, ratio] of Object.entries(ratios)) {
      expect(
        ratio,
        `${theme} ${pair} must clear WCAG AA for normal text`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('the lit quick-switcher tab is readable (audit 4)', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.locator('.nb-qs-bar')).toBeVisible({ timeout: 30_000 });

  const ratio = await page.evaluate(
    ([contrastSrc, bgSrc]) => {
      const contrast = eval(contrastSrc) as (a: string, b: string) => number;
      const paintedBg = eval(bgSrc) as (el: Element) => string;
      const tab = document.querySelector('.nb-qs-tab.is-active')!;
      return contrast(getComputedStyle(tab).color, paintedBg(tab));
    },
    [CONTRAST_FN, PAINTED_BG_FN] as const,
  );

  // Was amber-deep on amber-light: 2.96:1, the worst pair in the app.
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

/* -------------------------------------------------------------------------- */
/* the invalid --radius-hand substitution                                      */
/* -------------------------------------------------------------------------- */

test('the quick-switcher bar keeps its hand-drawn corners (audit 1)', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.locator('.nb-qs-bar')).toBeVisible({ timeout: 30_000 });

  const radius = await page.evaluate(
    () => getComputedStyle(document.querySelector('.nb-qs-bar')!).borderRadius,
  );
  // An invalid shorthand (the --radius-hand-in-a-4-value-slot bug) computes
  // to "0px"; a valid wobble computes to four distinct non-zero corners.
  expect(radius).not.toMatch(/^0px/);
  const corners = radius.split('/')[0].trim().split(/\s+/);
  expect(corners.length).toBe(4);
  for (const corner of corners) {
    expect(Number.parseFloat(corner)).toBeGreaterThan(4);
  }
});

/* -------------------------------------------------------------------------- */
/* settings controls                                                           */
/* -------------------------------------------------------------------------- */

test('slider readouts sit on their control, and the track fills (audit 8, 9)', async ({
  page,
}) => {
  await openSettings(page);

  const report = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.nbs-slider-group')];
    return groups.map((group) => {
      const wrap = group.querySelector('.nbs-slider-wrap') as HTMLElement;
      const value = group.querySelector('.nbs-slider-value');
      const wrapRect = wrap.getBoundingClientRect();
      return {
        hasValue: value !== null,
        // Distance between the end of the track and its readout.
        gap: value
          ? Math.round(value.getBoundingClientRect().left - wrapRect.right)
          : Number.POSITIVE_INFINITY,
        fill: Number.parseFloat(
          getComputedStyle(wrap).getPropertyValue('--nbs-fill'),
        ),
      };
    });
  });

  expect(report.length).toBeGreaterThan(5); // body size, zoom, 5 volumes
  for (const row of report) {
    // Every slider carries its own number (it used to live in the row hint,
    // 120–180px away on the far side of the row).
    expect(row.hasValue).toBe(true);
    expect(row.gap).toBeLessThan(28);
    // And the track knows where the thumb is, so it can paint a fill.
    expect(Number.isFinite(row.fill)).toBe(true);
    expect(row.fill).toBeGreaterThanOrEqual(0);
    expect(row.fill).toBeLessThanOrEqual(100);
  }
});

test('unselected chips are visibly pressable (audit 7)', async ({ page }) => {
  await openSettings(page);

  const chips = await page.evaluate(() => {
    const resting = [
      ...document.querySelectorAll('.nbs-seg-chip:not([aria-pressed="true"])'),
    ].slice(0, 6);
    return resting.map((chip) => {
      const s = getComputedStyle(chip);
      return {
        borderColor: s.borderTopColor,
        borderWidth: Number.parseFloat(s.borderTopWidth),
        background: s.backgroundColor,
        fontSize: Number.parseFloat(s.fontSize),
      };
    });
  });

  expect(chips.length).toBeGreaterThan(0);
  for (const chip of chips) {
    // A resting chip used to be `border: 1.4px dashed transparent` with no
    // fill — indistinguishable from a caption.
    expect(chip.borderColor).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // 1.4px authored; Chromium snaps computed border-width to device pixels.
    expect(chip.borderWidth).toBeGreaterThanOrEqual(1);
    expect(chip.background).not.toMatch(/rgba\(0, 0, 0, 0\)/);
    expect(chip.fontSize).toBeGreaterThanOrEqual(13); // handwriting floor
  }
});

test('keybinding rows share one right edge (audit 14)', async ({ page }) => {
  await openSettings(page);
  await page.locator('.nbs-keys-item').first().scrollIntoViewIfNeeded();

  const rights = await page.evaluate(() =>
    [...document.querySelectorAll('.nbs-keys-combo')].map((el) =>
      Math.round(el.getBoundingClientRect().right),
    ),
  );

  expect(rights.length).toBeGreaterThan(3);
  // One-, two- and three-chip bindings used to each start at a different x.
  expect(Math.max(...rights) - Math.min(...rights)).toBeLessThanOrEqual(1);
});

test('no readable settings copy is set below 12px (audit 6)', async ({
  page,
}) => {
  await openSettings(page);

  const tooSmall = await page.evaluate(() => {
    const out: { cls: string; text: string; size: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.nbs-sheet *')) {
      if (el.children.length > 0) continue;
      const text = (el.textContent ?? '').trim();
      if (text.length < 2) continue; // lone glyphs are ornament
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) {
        out.push({ cls: String(el.className), text: text.slice(0, 24), size });
      }
    }
    return out;
  });

  expect(tooSmall, JSON.stringify(tooSmall)).toEqual([]);
});

test('disabled controls stay readable rather than vanishing (audit 10)', async ({
  page,
}) => {
  await openSettings(page);

  const ratios = await page.evaluate(
    ([contrastSrc, bgSrc]) => {
      const contrast = eval(contrastSrc) as (a: string, b: string) => number;
      const paintedBg = eval(bgSrc) as (el: Element) => string;
      return [...document.querySelectorAll('.nbs-action-btn:disabled')].map(
        (btn) => {
          const s = getComputedStyle(btn);
          // Fold the element's own opacity into the measured foreground.
          const alpha = Number.parseFloat(s.opacity);
          const rgb = s.color.match(/[\d.]+/g)!;
          const fg = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
          return contrast(fg, paintedBg(btn));
        },
      );
    },
    [CONTRAST_FN, PAINTED_BG_FN] as const,
  );

  // In the browser stub these are disabled (desktop-only actions).
  for (const ratio of ratios) {
    // Was opacity 0.4 → an unreadable smudge, well under 3:1.
    expect(ratio).toBeGreaterThanOrEqual(3);
  }
});

/* -------------------------------------------------------------------------- */
/* cheat sheet                                                                 */
/* -------------------------------------------------------------------------- */

test('cheat-sheet descriptions align on one edge per column (audit 11)', async ({
  page,
}) => {
  await openBookView(page);
  // BookView ignores `?` while the caret is in prose, and mounting a leaf
  // focuses its editor — step out of the text before asking for the sheet.
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.keyboard.press('?');
  await expect(page.locator('[data-testid="cheat-sheet"]')).toBeVisible({
    timeout: 30_000,
  });

  // offsetLeft, NOT getBoundingClientRect: the card carries a deliberate
  // rotate(-0.5deg), which skews client rects by ~1.75px across a column's
  // height even when the layout edges are pixel-identical.
  const columns = await page.evaluate(() =>
    [...document.querySelectorAll('.nb-cheat-column')].map((column) =>
      [...column.querySelectorAll<HTMLElement>('.nb-cheat-what')].map(
        (el) => el.offsetLeft,
      ),
    ),
  );

  expect(columns.length).toBe(2);
  for (const lefts of columns) {
    expect(lefts.length).toBeGreaterThan(4);
    // `min-width: 92px` on a flex key let long keys push their description
    // right, producing three different left edges inside one column.
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
  }
});

/* -------------------------------------------------------------------------- */
/* chrome placement                                                            */
/* -------------------------------------------------------------------------- */

test('the toast clears the book and the title plate (audit 17)', async ({
  page,
}) => {
  await openBookView(page);
  await page.getByRole('button', { name: 'Copy AI spec' }).click();

  const toast = page.locator('.nb-script-toast');
  await expect(toast).toBeVisible({ timeout: 15_000 });

  const overlap = await page.evaluate(() => {
    const rect = (sel: string) =>
      document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const t = rect('.nb-script-toast')!;
    const hits = (o: DOMRect | null) =>
      o !== null &&
      t.left < o.right &&
      t.right > o.left &&
      t.top < o.bottom &&
      t.bottom > o.top;
    return {
      plate: hits(rect('.nb-book-title-plate')),
      cover: hits(rect('.nb-book-cover')),
      back: hits(rect('.nb-back-button')),
      inViewport: t.top >= 0 && t.right <= window.innerWidth,
    };
  });

  // It used to sit at bottom:32px, i.e. inside the open book.
  expect(overlap.plate).toBe(false);
  expect(overlap.cover).toBe(false);
  expect(overlap.back).toBe(false);
  expect(overlap.inViewport).toBe(true);
});

test('focus mode fades the app-level chrome too (audit 18)', async ({
  page,
}) => {
  await openBookView(page);
  const opacity = () =>
    page.evaluate(() => ({
      gear: Number.parseFloat(
        getComputedStyle(document.querySelector('.nbs-gear-button')!).opacity,
      ),
      dev: Number.parseFloat(
        getComputedStyle(document.querySelector('.nb-dev-switcher')!).opacity,
      ),
    }));

  // openBookView clicks the dev pill, leaving the cursor parked on it — the
  // pill lifts to full opacity on :hover by design, so park the mouse in
  // dead space before measuring the fade.
  await page.mouse.move(4, 4);

  const before = await opacity();
  expect(before.gear).toBeGreaterThan(0.5);

  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.keyboard.press('F9');
  await expect(page.locator('.nb-book-view.is-focus-mode')).toBeAttached({
    timeout: 15_000,
  });

  // The gear and the dev pill live outside .nb-book-view, so the rail's fade
  // never reached them and they stayed lit over a deliberately dimmed desk.
  await expect.poll(async () => (await opacity()).gear, { timeout: 10_000 })
    .toBeLessThan(0.2);
  await expect.poll(async () => (await opacity()).dev, { timeout: 10_000 })
    .toBeLessThan(0.2);
});

/* -------------------------------------------------------------------------- */
/* quick switcher mode handling                                                */
/* -------------------------------------------------------------------------- */

test('the `>` mode prefix never shows in the field (audit 20)', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const input = page.locator('.nb-qs-input');
  await expect(input).toBeVisible({ timeout: 30_000 });

  await input.type('>shelf');
  await expect(page.locator('.nb-qs-tab.is-active')).toHaveText('search text');
  // The tab already reports the mode; the raw prefix is redundant.
  await expect(input).toHaveValue('shelf');

  // Backspacing an empty content query drops the mode instead of dead-ending
  // (the browser fires no input event once the visible value is empty).
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Backspace');
  await expect(input).toHaveValue('');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.nb-qs-tab.is-active')).toHaveText('go to');
});

test('result meta pins to the row edge (audit 21)', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.locator('.nb-qs-row').first()).toBeVisible({
    timeout: 30_000,
  });

  const inset = await page.evaluate(() => {
    const row = document.querySelector('.nb-qs-row')!;
    const meta = row.querySelector('.nb-qs-row-meta');
    if (meta === null) return null;
    return Math.round(
      row.getBoundingClientRect().right - meta.getBoundingClientRect().right,
    );
  });

  expect(inset).not.toBeNull();
  // Meta used to trail the title inline; now it rides the row's right edge
  // (row padding is 12px).
  expect(inset!).toBeLessThanOrEqual(20);
});
