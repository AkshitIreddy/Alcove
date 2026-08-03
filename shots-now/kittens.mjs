/**
 * shots-now/kittens.mjs — photograph the welcome book's drawn kittens.
 *
 * They are inline SVG data URIs in src/data/seed.ts (the welcome book has to
 * work on a machine that has never been online), so they get looked at the
 * same way any other art in this app does: rendered, screenshotted, judged.
 *
 * Usage: node shots-now/kittens.mjs [board.html] [out.png]
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const board = resolve(process.argv[2] ?? 'shots-now/kittens.html');
const out = process.argv[3] ?? 'shots-now/kittens.png';

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 700, height: 260 }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL(board).href, { waitUntil: 'load' });
await p.screenshot({ path: out, fullPage: true });
console.log('  ->', out);
await b.close();
