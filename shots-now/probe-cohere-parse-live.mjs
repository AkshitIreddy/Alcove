/**
 * Native, live Cohere Parse smoke for Alcove's managed-PDF path.
 *
 * Preconditions:
 * - `npm run tauri:qa` is running with its hidden/taskbar-free QA shell.
 * - A Cohere credential is already available to the Rust credential manager.
 *
 * The probe creates two PDFs entirely in memory: a born-digital page with a
 * table, and a scan-like page whose words exist only as JPEG pixels. Both are
 * saved through the native content-addressed attachment store and processed by
 * the same high-level parser used by production source intake. It never reads,
 * prints, serialises or replaces the key, and the QA launcher keeps the whole
 * library under a disposable `alcove-qa-*` data root.
 *
 *   node shots-now/probe-cohere-parse-live.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const cdp = process.env.ALCOVE_QA_CDP_URL?.trim() || 'http://127.0.0.1:9222';
const out = resolve('qa/cohere-parse-live');
const bornToken = 'ALCOVE PARSE QA 7321';
const scanToken = 'ORCHARD 8427';

function pdf(objects) {
  const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const bytes = Buffer.isBuffer(object) ? object : Buffer.from(object, 'binary');
    const framed = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'ascii'),
      bytes,
      Buffer.from('\nendobj\n', 'ascii'),
    ]);
    chunks.push(framed);
    length += framed.length;
  });
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join('');
  return Buffer.concat([...chunks, Buffer.from(xref, 'ascii')]);
}

function stream(dictionary, bytes) {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`, 'ascii'),
    bytes,
    Buffer.from('\nendstream', 'ascii'),
  ]);
}

function escapePdfText(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function bornDigitalPdf() {
  const lines = [
    'BT /F1 25 Tf 54 736 Td',
    `(${escapePdfText(bornToken)}) Tj`,
    '0 -42 Td /F1 13 Tf',
    '(A born-digital parsing specimen with a two-column crop table.) Tj',
    '0 -68 Td /F1 14 Tf (CROP) Tj 230 0 Td (YIELD KG) Tj',
    '-230 -34 Td /F1 13 Tf (APPLES) Tj 230 0 Td (18) Tj',
    '-230 -30 Td (PEARS) Tj 230 0 Td (12) Tj',
    '-230 -30 Td (PLUMS) Tj 230 0 Td (9) Tj ET',
    '0.8 w 48 614 m 544 614 l S',
    '48 578 m 544 578 l S',
    '48 546 m 544 546 l S',
    '48 514 m 544 514 l S',
    '48 482 m 544 482 l S',
    '48 482 m 48 614 l S',
    '300 482 m 300 614 l S',
    '544 482 m 544 614 l S',
  ].join('\n');
  const content = Buffer.from(lines, 'ascii');
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 592 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('', content),
  ]);
}

function scannedPdf(jpeg) {
  const image = stream(
    `/Type /XObject /Subtype /Image /Width 1200 /Height 1600 ` +
      '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
    jpeg,
  );
  const content = Buffer.from('q 560 0 0 746 16 23 cm /Scan Do Q', 'ascii');
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 592 792] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>',
    image,
    stream('', content),
  ]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceSummary(source, expectedToken) {
  const text = source.pages.map((page) => page.text).join('\n');
  const fullPageVisuals = source.pages.flatMap((page) => page.visuals);
  return {
    pageCount: source.pageCount,
    textCharacters: text.length,
    foundExpectedToken: text.toUpperCase().includes(expectedToken),
    hasMarkdownStructure: /(^|\n)\s*(?:#{1,6}\s|[-*]\s|\|.+\|)/m.test(text),
    visualEvidenceAvailable: source.pages.every((page) => page.visualEvidence === 'available'),
    unresolvedVisualCount: source.pages.reduce(
      (count, page) => count + page.unresolvedVisualCount,
      0,
    ),
    fullPageJpegCount: fullPageVisuals.filter((visual) => visual.mimeType === 'image/jpeg').length,
    // Report digests, never provider text. These are content hashes of the
    // managed page images, not credentials or source content.
    pageImageDigests: fullPageVisuals.map((visual) => visual.sha256),
  };
}

await mkdir(out, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  cdp,
  status: 'running',
  fixtures: [
    { kind: 'born-digital-table', expectedToken: bornToken },
    { kind: 'scan-like-jpeg-page', expectedToken: scanToken },
  ],
};

let browser;
try {
  browser = await chromium.connectOverCDP(cdp);
  const context = browser.contexts()[0];
  assert(context !== undefined, 'The native QA WebView context is absent.');
  const page = context.pages().find((candidate) => candidate.url().includes('qa-silent=1'));
  assert(page !== undefined, 'The hidden native QA page is absent. Start `npm run tauri:qa` first.');
  page.setDefaultTimeout(5 * 60_000);

  const scanJpeg = Buffer.from(await page.evaluate(async (token) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('Could not create the scan fixture canvas.');
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#c7beb0';
    ctx.lineWidth = 3;
    for (let y = 180; y < 1450; y += 90) {
      ctx.beginPath();
      ctx.moveTo(80, y);
      ctx.lineTo(1120, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#191714';
    ctx.font = '700 76px Arial, sans-serif';
    ctx.fillText('SCANNED ORCHARD LOG', 90, 145);
    ctx.font = '700 88px Arial, sans-serif';
    ctx.fillText(token, 90, 320);
    ctx.font = '44px Arial, sans-serif';
    ctx.fillText('This sentence exists only inside the page pixels.', 90, 440);
    ctx.fillText('Rows inspected: apples 18, pears 12, plums 9.', 90, 535);
    ctx.strokeStyle = '#26231f';
    ctx.lineWidth = 5;
    ctx.strokeRect(85, 650, 1030, 430);
    ctx.beginPath();
    ctx.moveTo(85, 775); ctx.lineTo(1115, 775);
    ctx.moveTo(85, 900); ctx.lineTo(1115, 900);
    ctx.moveTo(600, 650); ctx.lineTo(600, 1080);
    ctx.stroke();
    ctx.font = '700 48px Arial, sans-serif';
    ctx.fillText('CROP', 130, 735);
    ctx.fillText('YIELD KG', 650, 735);
    ctx.font = '46px Arial, sans-serif';
    ctx.fillText('APPLES', 130, 855); ctx.fillText('18', 650, 855);
    ctx.fillText('PEARS', 130, 980); ctx.fillText('12', 650, 980);
    const blob = await new Promise((accept, reject) => canvas.toBlob(
      (value) => value === null ? reject(new Error('JPEG encoding failed.')) : accept(value),
      'image/jpeg',
      0.94,
    ));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, scanToken));

  const born = bornDigitalPdf();
  const scan = scannedPdf(scanJpeg);
  const payload = await page.evaluate(async ({ bornBytes, scanBytes, bornMarker, scanMarker }) => {
    const gateway = await import('/src/data/aiGateway.ts');
    const credentials = await import('/src/data/aiCredentials.ts');
    const appSettings = await import('/src/data/settings.ts');
    const sound = await import('/src/sound/engine.ts');
    const parser = await import('/src/features/aiAgent/coherePdfParser.ts');
    const library = await globalThis.__TAURI_INTERNALS__.invoke('library_info');
    const credential = await credentials.aiCredentialStatus();
    const declaredSettings = await appSettings.load();
    if (!/alcove-qa-/i.test(library.root)) {
      throw new Error(`Refusing non-isolated library root: ${library.root}`);
    }
    if (!credential.configured) {
      throw new Error('No Cohere credential is configured for native QA.');
    }
    if (!sound.qaAudioForcedSilent()) {
      throw new Error('The native QA shell is not forcing audio silent.');
    }
    const created = [];
    const derived = [];
    const rememberDerived = (source) => {
      for (const item of source.pages.flatMap((pageItem) => pageItem.visuals)) {
        if (!created.includes(item.attachmentId)) derived.push(item.attachmentId);
      }
    };
    try {
      const bornAttachment = await gateway.saveAiAttachment(new Uint8Array(bornBytes));
      const scanAttachment = await gateway.saveAiAttachment(new Uint8Array(scanBytes));
      created.push(bornAttachment.id, scanAttachment.id);
      const bornRoundTrip = await gateway.readAiAttachment(bornAttachment.id);
      const scanRoundTrip = await gateway.readAiAttachment(scanAttachment.id);
      const bornLocal = await gateway.extractAiPdfSource(bornAttachment.id);
      const scanLocal = await gateway.extractAiPdfSource(scanAttachment.id);
      const bornEnhanced = await parser.extractAiPdfSourceWithCohere(
        bornAttachment.id,
        new AbortController().signal,
        true,
      );
      rememberDerived(bornEnhanced);
      const scanEnhanced = await parser.extractAiPdfSourceWithCohere(
        scanAttachment.id,
        new AbortController().signal,
        true,
      );
      rememberDerived(scanEnhanced);

      // Induce a provider failure through the pipeline's provider callback.
      // The same page orchestration used above must retain local text and the
      // locally rendered page instead of failing source intake.
      let interceptedParseCalls = 0;
      const fallback = await parser.enrichPdfSourceWithCohere({
        runId: 'qa-induced-parse-outage',
        pdfBytes: new Uint8Array(bornBytes),
        localSource: bornLocal,
        signal: new AbortController().signal,
        async savePageImage(bytes) {
          const saved = await gateway.saveAiAttachment(bytes);
          return { attachmentId: saved.id, sha256: saved.sha256 };
        },
        async parsePage() {
          interceptedParseCalls += 1;
          throw {
            code: 'network',
            message: 'QA-induced Cohere Parse outage',
            retryable: true,
          };
        },
      });
      rememberDerived(fallback);

      return {
        boundary: {
          library,
          credential,
          credentialTier: {
            declaredKeyKind: declaredSettings.aiAgentKeyKind,
            providerVerified: false,
            note: 'Cohere credential status does not expose account tier; the live call proves Parse access, not the key tier.',
          },
          qaAudioForcedSilent: sound.qaAudioForcedSilent(),
        },
        roundTrip: {
          born: {
            kind: bornRoundTrip.metadata.kind,
            byteLength: bornRoundTrip.bytes.length,
            digestMatches: bornRoundTrip.metadata.sha256 === bornAttachment.sha256,
          },
          scan: {
            kind: scanRoundTrip.metadata.kind,
            byteLength: scanRoundTrip.bytes.length,
            digestMatches: scanRoundTrip.metadata.sha256 === scanAttachment.sha256,
          },
        },
        local: {
          bornTextCharacters: bornLocal.pages.reduce((sum, item) => sum + item.text.length, 0),
          scanNeedsOcr: scanLocal.pages.every((item) => item.needsOcr),
          scanContainsPixelToken: scanLocal.pages.some((item) =>
            item.text.toUpperCase().includes(scanMarker)),
        },
        enhanced: {
          born: {
            source: bornEnhanced,
            expectedToken: bornMarker,
          },
          scan: {
            source: scanEnhanced,
            expectedToken: scanMarker,
          },
        },
        fallback: {
          interceptedParseCalls,
          pageCount: fallback.pageCount,
          retainedLocalToken: fallback.pages.some((item) =>
            item.text.toUpperCase().includes(bornMarker)),
          availablePageVisuals: fallback.pages.filter((item) =>
            item.visualEvidence === 'available').length,
        },
      };
    } finally {
      for (const attachmentId of [...new Set([...derived, ...created])]) {
        await gateway.deleteAiAttachment(attachmentId).catch(() => false);
      }
    }
  }, {
    bornBytes: [...born],
    scanBytes: [...scan],
    bornMarker: bornToken,
    scanMarker: scanToken,
  });

  report.boundary = payload.boundary;
  report.roundTrip = payload.roundTrip;
  report.local = payload.local;
  report.enhanced = {
    born: sourceSummary(payload.enhanced.born.source, bornToken),
    scan: sourceSummary(payload.enhanced.scan.source, scanToken),
  };
  report.fallback = payload.fallback;
  // The scan token has no PDF text object, so seeing it here is evidence of a
  // real Parse/OCR result rather than Alcove's local `pdf-extract` fallback.
  report.aggregateMode = report.enhanced.scan.foundExpectedToken
    ? 'cohere-parse'
    : 'local-fallback';

  assert(payload.boundary.credential.configured, 'No Cohere credential is configured for native QA.');
  assert(payload.boundary.qaAudioForcedSilent, 'The native QA shell is not forcing audio silent.');
  assert(/alcove-qa-/i.test(payload.boundary.library.root),
    `Refusing non-isolated library root: ${payload.boundary.library.root}`);
  assert(payload.roundTrip.born.kind === 'pdf' && payload.roundTrip.scan.kind === 'pdf',
    'The native attachment store did not classify both fixtures as PDFs.');
  assert(payload.roundTrip.born.digestMatches && payload.roundTrip.scan.digestMatches,
    'A managed PDF did not survive its native content-addressed round trip.');
  assert(payload.local.bornTextCharacters > 40,
    'The born-digital baseline did not provide meaningful local fallback text.');
  assert(payload.local.scanNeedsOcr && !payload.local.scanContainsPixelToken,
    'The scan fixture accidentally exposed its pixel-only token as local PDF text.');
  assert(report.enhanced.born.foundExpectedToken,
    'Cohere Parse lost the born-digital fixture token.');
  assert(report.enhanced.born.hasMarkdownStructure,
    'Cohere Parse did not return structured Markdown for the table fixture.');
  assert(report.enhanced.scan.foundExpectedToken,
    'Cohere Parse did not OCR the scan-only fixture token.');
  for (const [kind, result] of Object.entries(report.enhanced)) {
    assert(result.visualEvidenceAvailable && result.unresolvedVisualCount === 0,
      `${kind} Parse result did not expose verified full-page visual evidence.`);
    assert(result.fullPageJpegCount >= result.pageCount,
      `${kind} Parse result did not retain a managed JPEG for each page.`);
  }
  assert(payload.fallback.interceptedParseCalls > 0,
    'The induced outage did not reach the Cohere Parse callback.');
  assert(payload.fallback.pageCount === 1 && payload.fallback.retainedLocalToken,
    'The induced Cohere outage did not return the local born-digital fallback.');
  assert(payload.fallback.availablePageVisuals === payload.fallback.pageCount,
    'The induced Cohere outage discarded the locally rendered page visual.');
  report.status = 'passed';
  process.stdout.write(
    `Cohere Parse live QA passed: ${report.enhanced.born.pageCount + report.enhanced.scan.pageCount} ` +
      `pages, scan OCR ${report.enhanced.scan.textCharacters} chars, native fallback retained.\n`,
  );
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  // `connectOverCDP().close()` disconnects Playwright. The hidden QA app and
  // its disposable root remain owned by `npm run tauri:qa` for root to stop.
  await browser?.close().catch(() => undefined);
  await writeFile(resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

if (report.status !== 'passed') {
  console.error(report.failure ?? 'Cohere Parse live QA failed.');
}
