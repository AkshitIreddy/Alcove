/**
 * The in-page audio tap + howler instrumentation, shared by the onboarding
 * probes. Lifted verbatim from shots-now/sound-grit.mjs (the tap) and extended
 * with a Howl.prototype hook that records the LOAD STATE at the moment each
 * play/volume/rate is issued — the thing the earlier tape could not see.
 */

export const INIT = `(() => {
  const g = globalThis;
  if (g.__nbAudioTap) return;

  try {
    const d = Object.getOwnPropertyDescriptor(Location.prototype, 'reload');
    if (d && d.configurable) {
      Object.defineProperty(Location.prototype, 'reload', {
        configurable: true,
        value: function () { g.__nbBlockedReloads = (g.__nbBlockedReloads || 0) + 1; },
      });
    }
  } catch {}

  const origConnect = AudioNode.prototype.connect;
  const origDisconnect = AudioNode.prototype.disconnect;
  const origStart = AudioBufferSourceNode.prototype.start;
  const origStop = AudioBufferSourceNode.prototype.stop;
  const origSVAT = AudioParam.prototype.setValueAtTime;
  const origLinear = AudioParam.prototype.linearRampToValueAtTime;
  const origXhrOpen = XMLHttpRequest.prototype.open;

  const bufferUrl = new WeakMap();
  const rawUrl = new WeakMap();
  const paramOwner = new WeakMap();
  // AudioParam -> the bufferSource it belongs to. playbackRate.value is the
  // INTRINSIC value and howler writes the rate with setValueAtTime, so reading
  // .value at start() reports 1 for every play and any reference render built
  // from it is at the wrong pitch. The scheduled value is tracked instead.
  const rateOwner = new WeakMap();
  const srcGain = new WeakMap();
  const srcInfo = new WeakMap();

  const tap = {
    origConnect,
    ctx: null,
    starts: [],
    stops: [],
    gains: [],
    howl: [],        // {call, state, playLock, queue, wall, t, key}
    rewires: [],     // {kind, t, wall} — every graph edit on the master bus
    installed: false,
    pcm: [],
    sampleRate: 0,
    recFrame0: null,
    marks: [],       // {label, wall, t}
  };
  g.__nbAudioTap = tap;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__nbUrl = String(url);
    this.addEventListener('load', () => {
      try {
        if (this.response instanceof ArrayBuffer) rawUrl.set(this.response, this.__nbUrl);
      } catch {}
    });
    return origXhrOpen.call(this, method, url, ...rest);
  };

  const patchDecode = (proto) => {
    const orig = proto.decodeAudioData;
    if (!orig || orig.__nbPatched) return;
    const wrapped = function (data, onOk, onErr) {
      const url = rawUrl.get(data) ?? '(unknown)';
      const tagIt = (buf) => { try { bufferUrl.set(buf, url); } catch {} return buf; };
      if (typeof onOk === 'function') {
        return orig.call(this, data, (buf) => { tagIt(buf); onOk(buf); }, onErr);
      }
      const p = orig.call(this, data);
      return p && p.then ? p.then(tagIt) : p;
    };
    wrapped.__nbPatched = true;
    proto.decodeAudioData = wrapped;
  };
  patchDecode(AudioContext.prototype);
  if (g.OfflineAudioContext) patchDecode(OfflineAudioContext.prototype);

  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      const H = g.__nbSound && g.__nbSound.howlerGlobal && g.__nbSound.howlerGlobal();
      if (H && H.masterGain === this) {
        tap.rewires.push({ kind: 'master.connect', t: this.context.currentTime, wall: Date.now() });
      }
    } catch {}
    try {
      const own = paramOwner.get(dest && dest.gain);
      if (own && typeof AudioBufferSourceNode !== 'undefined' && this instanceof AudioBufferSourceNode) {
        srcGain.set(this, own.id);
      }
    } catch {}
    try {
      const ctx = this.context;
      if (dest && ctx && dest === ctx.destination) {
        let sink = ctx.__nbSink;
        if (!sink) {
          sink = ctx.createGain();
          sink.gain.value = 1;
          ctx.__nbSink = sink;
          tap.ctx = ctx;
          tap.sampleRate = ctx.sampleRate;
          origConnect.call(sink, ctx.destination);
        }
        return origConnect.call(this, sink, ...rest);
      }
    } catch {}
    return origConnect.call(this, dest, ...rest);
  };

  // Every graph edit that touches howler's master gain, timed on the render
  // clock — a rewire is invisible on a wall clock and this is the moment the
  // window has to be centred on.
  AudioNode.prototype.disconnect = function (...a) {
    try {
      const H = g.__nbSound && g.__nbSound.howlerGlobal && g.__nbSound.howlerGlobal();
      if (H && H.masterGain === this) {
        tap.rewires.push({ kind: 'master.disconnect', t: this.context.currentTime, wall: Date.now() });
      }
    } catch {}
    return origDisconnect.apply(this, a);
  };

  AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
    let url = '(no buffer)';
    let dur = 0;
    try {
      if (this.buffer) { url = bufferUrl.get(this.buffer) ?? '(untagged)'; dur = this.buffer.duration; }
    } catch {}
    const ctx = this.context;
    // The bus chain AS IT IS FOR THIS VOICE. Read here rather than at the end
    // of the take: the chain is re-wired whenever the set changes, so a single
    // snapshot afterwards would describe the wrong filter for most of the tape.
    let stages = [];
    try {
      stages = (g.__nbSound.busFilterNodes() || []).map((n) => ({
        type: n.type, frequency: n.frequency.value, Q: n.Q.value, gain: n.gain.value,
      }));
    } catch {}
    const rec = {
      t: ctx.currentTime,
      stages,
      when: when ?? 0,
      offset: offset ?? 0,
      duration: duration ?? null,
      bufDur: dur,
      rate: (this.__nbRate !== undefined ? this.__nbRate : this.playbackRate.value),
      url,
      wall: Date.now(),
      gainId: srcGain.get(this) ?? null,
      gainMark: tap.gains.length,
      howlMark: tap.howl.length,
      stoppedAt: null,
    };
    srcInfo.set(this, rec);
    tap.starts.push(rec);
    return origStart.call(this, when, offset, duration);
  };

  // A hard cut is a discontinuity: note every stop() and how far into the
  // buffer it landed, so a truncated tail can be told from a finished one.
  AudioBufferSourceNode.prototype.stop = function (when) {
    try {
      const rec = srcInfo.get(this);
      const ctx = this.context;
      if (rec) {
        rec.stoppedAt = ctx.currentTime;
        tap.stops.push({ t: ctx.currentTime, when: when ?? 0, url: rec.url, sinceStart: ctx.currentTime - rec.t, bufDur: rec.bufDur });
      }
    } catch {}
    return origStop.call(this, when);
  };

  const origCreateBufferSource = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function (...a) {
    const node = origCreateBufferSource.apply(this, a);
    try { rateOwner.set(node.playbackRate, node); node.__nbRate = node.playbackRate.value; } catch {}
    return node;
  };

  let gainSeq = 0;
  const origCreateGain = AudioContext.prototype.createGain;
  AudioContext.prototype.createGain = function (...a) {
    const node = origCreateGain.apply(this, a);
    try { paramOwner.set(node.gain, { id: 'g' + gainSeq++, node }); } catch {}
    return node;
  };

  AudioParam.prototype.setValueAtTime = function (value, when) {
    try {
      const own = paramOwner.get(this);
      if (own) tap.gains.push({ kind: 'set', id: own.id, value, when, now: own.node.context.currentTime, wall: Date.now() });
      const src = rateOwner.get(this);
      if (src) src.__nbRate = value;
    } catch {}
    return origSVAT.call(this, value, when);
  };
  AudioParam.prototype.linearRampToValueAtTime = function (value, when) {
    try {
      const own = paramOwner.get(this);
      if (own) tap.gains.push({ kind: 'ramp', id: own.id, value, when, now: own.node.context.currentTime, wall: Date.now() });
    } catch {}
    return origLinear.call(this, value, when);
  };
})();`;

/** Patch Howl.prototype once a Howl exists. Idempotent; returns what it did. */
export const HOWL_HOOK = () => {
  const g = globalThis;
  const tap = g.__nbAudioTap;
  const H = g.__nbSound?.howlerGlobal?.();
  if (!H || !H._howls || H._howls.length === 0) return { ok: false, why: 'no Howl built yet' };
  const proto = Object.getPrototypeOf(H._howls[0]);
  if (proto.__nbHooked) return { ok: true, already: true };
  const keyOf = (h) => {
    try { return String(h._src).split('/').pop().split('?')[0]; } catch { return '?'; }
  };
  for (const name of ['play', 'volume', 'rate', 'stop', 'fade']) {
    const orig = proto[name];
    proto[name] = function (...a) {
      try {
        tap.howl.push({
          call: name,
          args: a.map((x) => (typeof x === 'number' ? +x.toFixed(4) : String(x))),
          state: this._state,
          playLock: !!this._playLock,
          queue: this._queue ? this._queue.length : -1,
          key: keyOf(this),
          wall: Date.now(),
          t: H.ctx ? H.ctx.currentTime : -1,
        });
      } catch {}
      return orig.apply(this, a);
    };
  }
  proto.__nbHooked = true;
  return { ok: true, hooked: true };
};

export const WORKLET = `
class NbRec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(16384);
    this.n = 0;
    this.frame0 = -1;
    this.dead = 0;
  }
  flush() {
    if (this.n === 0) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ frame: this.frame0, data: out, dead: this.dead }, [out.buffer]);
    this.frame0 += this.n;
    this.n = 0;
  }
  process(inputs, outputs) {
    if (this.frame0 < 0) this.frame0 = currentFrame;
    const inp = inputs[0];
    const out = outputs[0];
    const a = inp && inp[0] ? inp[0] : null;
    const b = inp && inp[1] ? inp[1] : null;
    if (!a) this.dead++;
    const len = 128;
    for (let i = 0; i < len; i++) {
      let v = 0;
      if (a) v += a[i];
      if (b) v += b[i];
      if (a && b) v *= 0.5;
      this.buf[this.n++] = v;
      if (out && out[0]) out[0][i] = a ? a[i] : 0;
      if (out && out[1]) out[1][i] = b ? b[i] : (a ? a[i] : 0);
    }
    if (this.n >= this.buf.length - 256) this.flush();
    return true;
  }
}
registerProcessor('nb-rec', NbRec);
`;
