/**
 * scripts/wav.mjs — read a RIFF/WAVE file into mono float samples.
 *
 * One reader, shared by `audit-sounds.mjs` (which measures the cues) and
 * `audition-sounds.mjs` (which stitches them into something you can listen to).
 * Deliberately one: a WAV the audition can play is then, by construction, a WAV
 * the audit can measure, and a bug in the decoder shows up in both rather than
 * making the two disagree about the same file.
 */

/**
 * Decode PCM 8/16/24/32-bit and 32-bit float, any channel count, to mono.
 *
 * Chunks are WALKED rather than read from fixed offsets. A WAV carrying a LIST
 * or `fact` chunk before its `data` is perfectly legal, and assuming the samples
 * begin at byte 44 is the classic way to read a valid file as a burst of noise —
 * which would have been read here as a defect in the sound rather than in this
 * function.
 */
export function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }

  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt) throw new Error('no fmt chunk');
  if (!data) throw new Error('no data chunk');

  const { channels, bits, format } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const mono = new Float32Array(frames);

  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      const o = (i * channels + c) * bytes;
      let v;
      if (format === 3 && bits === 32) {
        v = data.readFloatLE(o);
      } else if (bits === 16) {
        v = data.readInt16LE(o) / 32768;
      } else if (bits === 24) {
        // Little-endian 24-bit, sign-extended by hand — there is no readInt24LE.
        let raw = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16);
        if (raw & 0x800000) raw |= ~0xffffff;
        v = raw / 8388608;
      } else if (bits === 8) {
        v = (data[o] - 128) / 128; // 8-bit PCM is unsigned
      } else if (bits === 32) {
        v = data.readInt32LE(o) / 2147483648;
      } else {
        throw new Error(`unsupported: ${bits}-bit format ${format}`);
      }
      sum += v;
    }
    mono[i] = sum / channels;
  }

  return { ...fmt, frames, mono };
}
