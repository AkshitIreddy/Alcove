/**
 * src/features/transfer/zip.ts — a tiny, dependency-free ZIP codec for the
 * Notebook Bundle (`.nbk`).
 *
 * Writing uses the STORE method (no compression): bundles are text-heavy but
 * small, and STORE keeps the writer to ~80 lines with no deflate
 * implementation and byte-identical, diffable output. Reading accepts both
 * STORE and DEFLATE so bundles written by the Rust side
 * (src-tauri/src/transfer.rs, which uses the `zip` crate with deflate) or by
 * any other zip tool open fine — deflate is inflated with the platform's
 * `DecompressionStream('deflate-raw')` (Chromium ≥ 80, Node ≥ 18).
 *
 * Zip64 and encryption are deliberately unsupported; both are rejected with a
 * diagnostic rather than mis-parsed. Everything here is pure (bytes in, bytes
 * out) and unit-tested in tests/transfer.test.ts.
 */

export interface ZipEntry {
  /** Forward-slash archive path. */
  path: string;
  bytes: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3, the polynomial ZIP mandates)
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  crcTable = t;
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = t[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Little-endian scratch writer
// ---------------------------------------------------------------------------

class ByteWriter {
  private buffer = new Uint8Array(1024);
  private length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }

  get offset(): number {
    return this.length;
  }

  u16(value: number): void {
    this.ensure(2);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
  }

  u32(value: number): void {
    this.ensure(4);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
    this.buffer[this.length++] = (value >>> 16) & 0xff;
    this.buffer[this.length++] = (value >>> 24) & 0xff;
  }

  raw(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  done(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** MS-DOS date/time pair for a JS date (2-second resolution, as ZIP wants). */
export function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date:
      (((year - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (date.getDate() & 0x1f),
    time:
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((date.getSeconds() >> 1) & 0x1f),
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Build a ZIP archive from entries, STORE method. Entry order is preserved
 * so the manifest always lands first and a bundle is deterministic for a
 * given input + timestamp.
 */
export function zipStore(
  entries: ReadonlyArray<ZipEntry>,
  modified = new Date(0),
): Uint8Array {
  const { date, time } = dosDateTime(modified);
  const out = new ByteWriter();
  const central: Array<{
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    offset: number;
  }> = [];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    const offset = out.offset;
    out.u32(LOCAL_SIG);
    out.u16(20); // version needed
    out.u16(0x0800); // UTF-8 names
    out.u16(METHOD_STORE);
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(entry.bytes.length);
    out.u32(entry.bytes.length);
    out.u16(nameBytes.length);
    out.u16(0); // extra length
    out.raw(nameBytes);
    out.raw(entry.bytes);
    central.push({ nameBytes, crc, size: entry.bytes.length, offset });
  }

  const centralStart = out.offset;
  for (const item of central) {
    out.u32(CENTRAL_SIG);
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0x0800);
    out.u16(METHOD_STORE);
    out.u16(time);
    out.u16(date);
    out.u32(item.crc);
    out.u32(item.size);
    out.u32(item.size);
    out.u16(item.nameBytes.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk
    out.u16(0); // internal attrs
    out.u32(0); // external attrs
    out.u32(item.offset);
    out.raw(item.nameBytes);
  }
  const centralSize = out.offset - centralStart;

  out.u32(EOCD_SIG);
  out.u16(0);
  out.u16(0);
  out.u16(central.length);
  out.u16(central.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0);
  return out.done();
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ZipReadResult {
  files: Map<string, Uint8Array>;
  /** Recovered problems (skipped entries, unsupported methods…). */
  warnings: string[];
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  const Ctor = (
    globalThis as {
      DecompressionStream?: new (format: string) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).DecompressionStream;
  if (Ctor === undefined) return null;
  try {
    const stream = new Ctor('deflate-raw');
    const writer = stream.writable.getWriter();
    void writer.write(bytes.slice());
    void writer.close();
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) chunks.push(value);
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Read a ZIP archive. Total: a corrupt archive resolves with whatever entries
 * could be recovered plus warnings — it never throws.
 */
export async function unzip(bytes: Uint8Array): Promise<ZipReadResult> {
  const files = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Locate the end-of-central-directory record (scan back over the comment).
  let eocd = -1;
  const from = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= from; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return { files, warnings: ['not a ZIP archive (no end-of-directory record)'] };
  }

  const count = view.getUint16(eocd + 10, true);
  const centralStart = view.getUint32(eocd + 16, true);
  if (centralStart === 0xffffffff || count === 0xffff) {
    return { files, warnings: ['Zip64 archives are not supported'] };
  }

  let cursor = centralStart;
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_SIG) {
      warnings.push('central directory ended early — some entries were skipped');
      break;
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLen),
    );
    cursor += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory entry
    if ((flags & 0x0001) !== 0) {
      warnings.push(`“${name}” is encrypted — skipped`);
      continue;
    }
    if (localOffset + 30 > bytes.length) {
      warnings.push(`“${name}” points outside the archive — skipped`);
      continue;
    }
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      warnings.push(`“${name}” has a broken local header — skipped`);
      continue;
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === METHOD_STORE) {
      files.set(name, data.slice());
    } else if (method === METHOD_DEFLATE) {
      const inflated = await inflateRaw(data);
      if (inflated === null) {
        warnings.push(`“${name}” is deflate-compressed and could not be read`);
      } else {
        files.set(name, inflated);
      }
    } else {
      warnings.push(`“${name}” uses an unsupported compression method`);
    }
  }
  return { files, warnings };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function textToBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** UTF-8 decode with a BOM strip (bundles hand-edited in Notepad). */
export function bytesToText(bytes: Uint8Array): string {
  const text = decoder.decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
