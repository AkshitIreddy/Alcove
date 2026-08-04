/**
 * Does a library ALREADY holding the outgoing 16-page tour get the new one?
 *
 * refreshWelcomeBook only replaces pages whose stored script source is byte
 * identical to something in SHIPPED_WELCOME_SOURCES. So the v5 sources have to
 * have moved into LEGACY_WELCOME_PAGE_SOURCES verbatim — a retyped em dash in
 * any one of them and that install keeps its old book forever, silently.
 *
 * Compares the committed file's WELCOME_PAGE_SOURCES against the working
 * copy's LEGACY_WELCOME_PAGE_SOURCES, as raw source text.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const grab = (text, name) => {
  const start = text.indexOf(`export const ${name}: readonly string[] = [`);
  if (start === -1) throw new Error(`no ${name}`);
  const from = text.indexOf('[', start) + 1;
  // the array ends at the first "\n];" after it
  const end = text.indexOf('\n];', from);
  return text.slice(from, end);
};

// split a TS array-of-template-literals body into its entries, respecting \` escapes
const entries = (body) => {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const tick = body.indexOf('`', i);
    if (tick === -1) break;
    let j = tick + 1;
    let buf = '';
    while (j < body.length) {
      if (body[j] === '\\') {
        buf += body[j] + body[j + 1];
        j += 2;
        continue;
      }
      if (body[j] === '`') break;
      buf += body[j];
      j += 1;
    }
    out.push(buf);
    i = j + 1;
  }
  return out;
};

const head = execFileSync('git', ['show', 'HEAD:src/data/seed.ts'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
const now = readFileSync('src/data/seed.ts', 'utf8');

const outgoing = entries(grab(head, 'WELCOME_PAGE_SOURCES'));
const legacy = entries(grab(now, 'LEGACY_WELCOME_PAGE_SOURCES'));
const live = entries(grab(now, 'WELCOME_PAGE_SOURCES'));
const headLegacy = entries(grab(head, 'LEGACY_WELCOME_PAGE_SOURCES'));

console.log('committed (v5) live pages :', outgoing.length);
console.log('committed legacy (v4)    :', headLegacy.length);
console.log('working legacy           :', legacy.length);
console.log('working live             :', live.length);

const missing = outgoing.filter((s) => !legacy.includes(s));
console.log('v5 pages NOT carried into legacy verbatim:', missing.length);
for (const s of missing) console.log('   ', JSON.stringify(s.slice(0, 70)));

const missingV4 = headLegacy.filter((s) => !legacy.includes(s));
console.log('v4 pages NOT carried into legacy verbatim:', missingV4.length);

const leaked = live.filter((s) => legacy.includes(s));
console.log('live pages also listed as retired:', leaked.length);
