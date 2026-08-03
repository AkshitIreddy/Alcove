/**
 * scripts/probe-shelf-builds.mjs — the carpentry, at the size the shelf shows it.
 *
 * The builds and the timber patterns were the last design vocabulary with no
 * quality tier, and a tier can only be decided by LOOKING. A studio card is
 * 148x102 and shrinks a 1200-world-px bookcase into it; at that size every
 * build is a brown rectangle with a fringe, which is exactly the picture that
 * cannot answer "is this one worth offering first".
 *
 * So this board draws the case the way `features/bookshelf/textures.ts` bakes
 * it — same four part drawers, same pads, same over-draw, same per-floor tiling
 * and the same mirrored right-hand upright — and then shows it at 1:1, which is
 * world px = CSS px = the shelf at zoom 1 (`createCamera`'s default, and the
 * zoom at which a 1440px viewport holds the whole case).
 *
 * Each build cell is three pictures, because one cannot say everything:
 *
 *  - a WHOLE-CASE strip across the top: cornice, one floor and the plinth,
 *    reduced to fit. Two things live only here — `pediment` puts its tablet at
 *    the centre of a 1228px board, and the plinth is the cornice's own bitmap
 *    upside down, which is half of what a crest is (charming teeth on top can
 *    be a row of broken ones underneath).
 *  - a 1:1 HEAD crop: wall, crest, cornice bands, gilt studs, the top of the
 *    opening and the upright's capital.
 *  - a 1:1 FOOT crop: the bottom of the opening, the shelf board with its
 *    trim, and the upright running past it into the next floor.
 *
 * The two 1:1 crops are stacked with the dead middle of the opening cut out —
 * 110 world px of flat recess that says nothing and costs a third of the cell.
 *
 * `--mode=patterns` swaps to the other axis: one board and one upright at true
 * world scale (a board is 40 world px tall and an upright 34 wide, so this is
 * the only framing in which fifty timber treatments are fifty different
 * pictures rather than fifty identical smudges).
 *
 * Sheets are composed in the page and returned as data URLs rather than
 * screenshotted through a locator: the dev server can reload underneath a long
 * board, and half a sheet is worse than no sheet.
 *
 * Usage: node scripts/probe-shelf-builds.mjs --dir=qa/ui [--mode=builds|patterns]
 *        [--only=id,id] [--tier=signature|shelf|niche|oddity] [--build=scriptorium]
 *        [--pattern=none] [--cols=3 --rows=3] [--tag=shelf]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const DIR = opt('dir', 'qa/ui');
const MODE = opt('mode', 'builds');
const ONLY = opt('only', '');
const TIER = opt('tier', '');
const BUILD = opt('build', 'scriptorium');
const PATTERN = opt('pattern', 'none');
const THEME = opt('theme', '');
const COLS = Number(opt('cols', MODE === 'patterns' ? '4' : '3'));
const ROWS = Number(opt('rows', MODE === 'patterns' ? '5' : '3'));
const TAG = opt('tag', MODE === 'patterns' ? 'shelf-patterns' : 'shelf-builds');

mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text());
});

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });

const result = await page.evaluate(
  async ({ mode, only, tier, build, pattern, cols, rows, themeId }) => {
    const S = await import('/src/art/shelfDesign.ts');
    const F = await import('/src/art/flatShelf.ts');
    const flat = await import('/src/art/flat.ts');
    const T = await import('/src/art/themes.ts');
    const K = await import('/src/features/bookshelf/constants.ts');

    const {
      SHELF_WIDTH,
      FLOOR_H,
      PLANK_H,
      BOOK_ZONE_H,
      RAIL_W,
      CROWN_H,
      CROWN_LIP,
      BASE_H,
    } = K;
    const CASE_W = SHELF_WIDTH + CROWN_LIP * 2;

    /* The room. Fixed, and the one a new library opens in, so what the board
       shows is what a reader meets before they change anything. */
    const scheme = T.getTheme(themeId.length > 0 ? themeId : T.DEFAULT_THEME_ID).scheme;

    /** `textures.outlinePad`, written out — the pads are half of what a part is. */
    const pad = (shortSide) => flat.inkWidth(shortSide) / 2 + shortSide * 0.012 + 0.5;

    const clipped = (g, x, y, w, h, paint) => {
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      paint();
      g.restore();
    };

    /**
     * The case in WORLD coordinates: (0,0) is the top-left of floor 0's recess,
     * the cornice hangs above it and the plinth stands under the last floor.
     *
     * Every call below mirrors `textures.ts` exactly — the pad, the over-draw,
     * the `frame` each drawer phase-locks its pattern to, and the clip that the
     * bake gets for free from its canvas edge.
     */
    const drawCase = (g, design, floors, books) => {
      const cp = pad(CROWN_H);
      const drawCrownInto = () =>
        clipped(g, -CROWN_LIP, -CROWN_H, CASE_W, CROWN_H, () => {
          F.drawCrown(g, -CROWN_LIP + cp, -CROWN_H + cp, CASE_W - cp * 2, CROWN_H - cp, 0x7ab3, design);
        });
      drawCrownInto();

      for (let f = 0; f < floors; f++) {
        const top = f * FLOOR_H;
        const over = Math.max(SHELF_WIDTH, BOOK_ZONE_H) * 0.05 + 8;
        clipped(g, 0, top, SHELF_WIDTH, BOOK_ZONE_H, () => {
          F.drawRecess(
            g, -over, top - over, SHELF_WIDTH + over * 2, BOOK_ZONE_H + over * 2, 0x9c31, design,
            { x: RAIL_W, y: top, w: SHELF_WIDTH - RAIL_W * 2, h: BOOK_ZONE_H },
          );
        });
        if (books) {
          const head = BOOK_ZONE_H * 0.08;
          F.drawBookRow(
            g, RAIL_W + 14, top + head, SHELF_WIDTH - RAIL_W * 2 - 28, BOOK_ZONE_H - head,
            0x1f35 + f * 101,
          );
        }
        const pp = pad(PLANK_H);
        clipped(g, 0, top + BOOK_ZONE_H, SHELF_WIDTH, PLANK_H, () => {
          F.drawPlank(
            g, pp, top + BOOK_ZONE_H + pp, SHELF_WIDTH - pp * 2, PLANK_H - pp, 0x51a1, design,
          );
        });
        const rp = pad(RAIL_W);
        const rOver = RAIL_W * 0.3 + flat.inkWidth(RAIL_W) + 2;
        for (const mirror of [false, true]) {
          g.save();
          if (mirror) {
            g.translate(SHELF_WIDTH, 0);
            g.scale(-1, 1);
          }
          clipped(g, 0, top, RAIL_W, FLOOR_H, () => {
            F.drawPost(
              g, rp, top - rOver, RAIL_W - rp * 2, FLOOR_H + rOver * 2, 0x2f19, design,
              { x: 0, y: top, w: RAIL_W, h: FLOOR_H },
            );
          });
          g.restore();
        }
      }

      // The plinth: the cornice's own bitmap, stood on its head under the last
      // floor. Half of what a build looks like — a crest that is charming on
      // top can be a row of broken teeth once it is turned over.
      const foot = floors * FLOOR_H;
      g.save();
      g.translate(0, foot + BASE_H);
      g.scale(1, -1);
      g.translate(0, CROWN_H);
      drawCrownInto();
      g.restore();
    };

    /** One board and one upright at TRUE world scale — the pattern axis. */
    const drawTimber = (g, w, h, design) => {
      g.fillStyle = scheme.recess;
      g.fillRect(0, 0, w, h);
      const rp = pad(RAIL_W);
      const rOver = RAIL_W * 0.3 + flat.inkWidth(RAIL_W) + 2;
      const postX = 26;
      clipped(g, postX, 0, RAIL_W, h, () => {
        F.drawPost(g, postX + rp, -rOver, RAIL_W - rp * 2, h + rOver * 2, 0x2f19, design, {
          x: postX, y: 0, w: RAIL_W, h: FLOOR_H,
        });
      });
      const pp = pad(PLANK_H);
      const boardY = h - PLANK_H - 10;
      clipped(g, 0, boardY, w, PLANK_H, () => {
        F.drawPlank(g, -30 + pp, boardY + pp, w + 60 - pp * 2, PLANK_H - pp, 0x51a1, design, {
          x: 0, y: boardY, w: SHELF_WIDTH, h: PLANK_H,
        });
      });
    };

    /* ------------------------------ the list ------------------------------ */

    const wanted = only.split(',').map((s) => s.trim()).filter(Boolean);
    const list =
      mode === 'patterns'
        ? S.PATTERN_IDS.map((id) => S.PATTERNS[id])
            .filter((p) => wanted.length === 0 || wanted.includes(p.id))
            .filter((p) => tier.length === 0 || p.tier === tier)
            .map((p) => ({
              id: p.id,
              name: p.name,
              tier: p.tier ?? '-',
              note: p.tags.join(' '),
              design: { build, pattern: p.id },
            }))
        : S.BUILD_IDS.map((id) => S.BUILDS[id])
            .filter((b) => wanted.length === 0 || wanted.includes(b.id))
            .filter((b) => tier.length === 0 || b.tier === tier)
            .map((b) => ({
              id: b.id,
              name: b.name,
              tier: b.tier ?? '-',
              note: `${b.opening}/${b.crown}/${b.crest} · ${b.plankTrim}+${b.postTrim} · shaft ${b.postShaft}`,
              design: { build: b.id, pattern },
            }));

    /* ------------------------------ the sheet ------------------------------ */

    const GAP = 10;
    const CAP = 28;
    const CELL_W = mode === 'patterns' ? 340 : 440;
    // The whole case, fitted: cornice + one floor + plinth.
    const WHOLE_H = mode === 'patterns' ? 0 : Math.round(((CROWN_H + FLOOR_H + BASE_H) * CELL_W) / CASE_W);
    // The two 1:1 windows into the case, as world-y ranges. `x` is the left end
    // of the case for both, a hair outside the cornice's lip.
    const CROP_X = -CROWN_LIP - 4;
    const HEAD = [-CROWN_H - 18, 152];
    const FOOT = [240, 352];
    const RULE = 3;
    const headH = HEAD[1] - HEAD[0];
    const footH = FOOT[1] - FOOT[0];
    const BODY_H = mode === 'patterns' ? 220 : headH + RULE + footH;

    const cellH = WHOLE_H + BODY_H + CAP;
    const sheets = [];
    const per = cols * rows;

    /** One 1:1 window onto the case, drawn into the cell at (x, y). */
    const window11 = (g, x, y, w, h, worldY, design) =>
      clipped(g, x, y, w, h, () => {
        g.save();
        g.translate(x, y);
        g.fillStyle = scheme.wall;
        g.fillRect(0, 0, w, h);
        g.translate(-CROP_X, -worldY);
        drawCase(g, design, 2, false);
        g.restore();
      });

    for (let i = 0; i < list.length; i += per) {
      const slice = list.slice(i, i + per);
      const nRows = Math.ceil(slice.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * CELL_W + (cols + 1) * GAP;
      c.height = nRows * cellH + (nRows + 1) * GAP;
      const g = c.getContext('2d');
      g.fillStyle = '#241a13';
      g.fillRect(0, 0, c.width, c.height);

      slice.forEach((item, k) => {
        const cx = GAP + (k % cols) * (CELL_W + GAP);
        const cy = GAP + Math.floor(k / cols) * (cellH + GAP);

        flat.setFlatScheme(scheme);
        try {
          if (mode === 'patterns') {
            g.save();
            g.translate(cx, cy);
            clipped(g, 0, 0, CELL_W, BODY_H, () => drawTimber(g, CELL_W, BODY_H, item.design));
            g.restore();
          } else {
            const k2 = CELL_W / CASE_W;
            clipped(g, cx, cy, CELL_W, WHOLE_H, () => {
              g.save();
              g.translate(cx, cy);
              g.fillStyle = scheme.wall;
              g.fillRect(0, 0, CELL_W, WHOLE_H);
              g.scale(k2, k2);
              g.translate(CROWN_LIP, CROWN_H);
              drawCase(g, item.design, 1, true);
              g.restore();
            });
            window11(g, cx, cy + WHOLE_H, CELL_W, headH, HEAD[0], item.design);
            g.fillStyle = '#241a13';
            g.fillRect(cx, cy + WHOLE_H + headH, CELL_W, RULE);
            window11(g, cx, cy + WHOLE_H + headH + RULE, CELL_W, footH, FOOT[0], item.design);
          }
        } finally {
          flat.setFlatScheme(null);
        }

        g.fillStyle = '#f2e8d8';
        g.font = '600 14px "Nunito Sans", system-ui, sans-serif';
        g.fillText(`${item.name}  [${item.tier}]`, cx + 2, cy + WHOLE_H + BODY_H + 15);
        g.fillStyle = '#b7a48c';
        g.font = '11px ui-monospace, monospace';
        g.fillText(`${item.id} · ${item.note}`, cx + 2, cy + WHOLE_H + BODY_H + 26);
      });

      sheets.push(c.toDataURL('image/png'));
    }

    return { sheets, ids: list.map((p) => `${p.tier}\t${p.id}\t${p.name}`) };
  },
  {
    mode: MODE,
    only: ONLY,
    tier: TIER,
    build: BUILD,
    pattern: PATTERN,
    cols: COLS,
    rows: ROWS,
    themeId: THEME,
  },
);

console.log(result.ids.join('\n'));
result.sheets.forEach((data, i) => {
  const path = `${DIR}/${TAG}-${i + 1}.png`;
  writeFileSync(path, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`shot ${path}`);
});

await browser.close();
