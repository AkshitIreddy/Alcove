/**
 * Public @pixi/sound master-bus filters.
 *
 * Pixi Sound exposes `filtersAll` as the supported seam for processing every
 * voice. Each stage below is a real BiquadFilterNode wrapped in Pixi Sound's
 * public Filter class; no private instance nodes are reached into and a failed
 * chain falls back to an empty filter list rather than disconnecting audio.
 */

export interface BusFilterStage {
  readonly type: BiquadFilterType;
  readonly frequency: number;
  readonly q?: number;
  readonly gain?: number;
}

export type BusFilter = readonly BusFilterStage[];
export const NO_BUS_FILTER: BusFilter = [];

const FREQ_MIN = 20;
const FREQ_MAX = 20_000;
const Q_MIN = 0.05;
const Q_MAX = 12;
export const BUS_FILTER_MAX_BOOST_DB = 4;
const GAIN_MIN_DB = -24;

const clamp = (v: number, lo: number, hi: number, fallback: number): number =>
  !Number.isFinite(v) ? fallback : v < lo ? lo : v > hi ? hi : v;

export interface ResolvedStage {
  readonly type: BiquadFilterType;
  readonly frequency: number;
  readonly q: number;
  readonly gain: number;
}

export function resolveStage(stage: BusFilterStage): ResolvedStage {
  return {
    type: stage.type,
    frequency: clamp(stage.frequency, FREQ_MIN, FREQ_MAX, 1000),
    q: clamp(stage.q ?? 0.7071, Q_MIN, Q_MAX, 0.7071),
    gain: clamp(stage.gain ?? 0, GAIN_MIN_DB, BUS_FILTER_MAX_BOOST_DB, 0),
  };
}

export function describeBusFilter(filter: BusFilter): string {
  return filter
    .map((raw) => {
      const s = resolveStage(raw);
      const gain = s.gain === 0 ? '' : `${s.gain > 0 ? '+' : ''}${s.gain}dB`;
      return `${s.type}@${Math.round(s.frequency)}Hz/Q${s.q.toFixed(2)}${gain}`;
    })
    .join(' + ');
}

export interface PixiFilterLike {
  readonly source?: AudioNode;
  readonly destination?: AudioNode;
  destroy(): void;
}

export type PixiFilterConstructor = new (
  destination: AudioNode,
  source?: AudioNode,
) => PixiFilterLike;

export interface PixiSoundGlobal {
  readonly supported?: boolean;
  readonly context?: {
    readonly audioContext?: AudioContext | null;
  };
  filtersAll: PixiFilterLike[];
}

export interface BusFilterStatus {
  readonly installed: boolean;
  readonly supported: boolean;
  readonly reason: string | null;
  readonly tag: string;
  readonly stages: readonly ResolvedStage[];
}

const IDLE: BusFilterStatus = {
  installed: false,
  supported: false,
  reason: 'web audio not started',
  tag: '',
  stages: [],
};

let status: BusFilterStatus = IDLE;
let wiredContext: AudioContext | null = null;
let wiredLibrary: PixiSoundGlobal | undefined;
let wiredTag = '';
let filters: PixiFilterLike[] = [];
let nodes: BiquadFilterNode[] = [];

export function busFilterStatus(): BusFilterStatus {
  return status;
}

export function busFilterNodes(): readonly BiquadFilterNode[] {
  return nodes;
}

function destroyFilters(): void {
  for (const filter of filters) {
    try {
      filter.destroy();
    } catch {
      // A closed device context has already disconnected these nodes.
    }
  }
  filters = [];
  nodes = [];
}

export function applyBusFilter(
  library: PixiSoundGlobal | undefined,
  FilterClass: PixiFilterConstructor | undefined,
  requested: BusFilter,
): BusFilterStatus {
  const tag = describeBusFilter(requested);
  if (library === undefined) {
    status = { ...IDLE, reason: '@pixi/sound not loaded' };
    return status;
  }
  const context = library.context?.audioContext ?? null;
  if (library.supported === false || context === null) {
    status = {
      installed: false,
      supported: false,
      reason: 'Web Audio is unavailable; cues use Pixi Sound legacy playback',
      tag: '',
      stages: [],
    };
    return status;
  }
  if (requested.length > 0 && FilterClass === undefined) {
    status = {
      installed: false,
      supported: true,
      reason: 'Pixi Sound Filter constructor unavailable',
      tag: '',
      stages: [],
    };
    return status;
  }
  if (wiredLibrary === library && wiredContext === context && wiredTag === tag) {
    return status;
  }

  const stages = requested.map(resolveStage);
  try {
    library.filtersAll = [];
    destroyFilters();
    const nextFilters: PixiFilterLike[] = [];
    const nextNodes: BiquadFilterNode[] = [];
    for (const stage of stages) {
      const node = context.createBiquadFilter();
      node.type = stage.type;
      node.frequency.value = stage.frequency;
      node.Q.value = stage.q;
      node.gain.value = stage.gain;
      nextNodes.push(node);
      nextFilters.push(new (FilterClass as PixiFilterConstructor)(node));
    }
    library.filtersAll = nextFilters;
    filters = nextFilters;
    nodes = nextNodes;
    wiredLibrary = library;
    wiredContext = context;
    wiredTag = tag;
    status = {
      installed: stages.length > 0,
      supported: true,
      reason: null,
      tag,
      stages,
    };
  } catch (error) {
    try {
      library.filtersAll = [];
    } catch {
      // The device/context is gone; recovery happens in the engine.
    }
    destroyFilters();
    wiredLibrary = library;
    wiredContext = context;
    wiredTag = '';
    status = {
      installed: false,
      supported: true,
      reason: `could not install Pixi Sound filters: ${String(error)}`,
      tag: '',
      stages: [],
    };
  }
  return status;
}

export function resetBusFilterForTests(): void {
  destroyFilters();
  wiredContext = null;
  wiredLibrary = undefined;
  wiredTag = '';
  status = IDLE;
}
