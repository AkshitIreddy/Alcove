/**
 * features/bookshelf/layout.ts — seeded per-floor book layout (pure).
 *
 * Raw slot positions (slotX) cluster every library at the left rail and leave
 * the right half of the case empty. Instead each floor lays its books out as
 * 1–4 small clusters spread across the usable width between the rails:
 * tight 1–5px gaps inside a cluster, generous seeded gaps between clusters,
 * and the leftover width distributed so the row reads pleasantly filled
 * without stretching sparse floors into a picket fence.
 *
 * The result is deterministic per (floor index, book list): same inputs ⇒
 * identical positions across sessions, virtualizer remounts, and LOD stamps.
 *
 * One or two books per floor may "lean" a few degrees into an adjacent
 * cluster gap — pure sprite rotation applied by the compositor, no physics.
 *
 * Pure math, no Pixi imports: unit-testable in node.
 */

import { mulberry32, type RandomFn } from '../../art/noise';
import { RAIL_W, SHELF_WIDTH } from './constants';

/** Books keep this much clearance from each rail. */
export const LAYOUT_MARGIN_X = RAIL_W + 30;

/** Extra lean applied to at most this many books per floor. */
export const MAX_LEANERS = 2;

/** Extra lean magnitude range, degrees. */
export const LEAN_MIN_DEG = 3.5;
export const LEAN_MAX_DEG = 7;

/** A cluster gap must be at least this wide for a neighbor to lean into it. */
const LEAN_GAP_MIN = 26;

/**
 * How wide a gap between two clusters may grow.
 *
 * It exists because the row used to absorb ALL of a floor's spare width into
 * its gaps: fourteen books in a 1200px case came out as four little islands
 * with a hand's width of empty plank between them. Capping the gap packs the
 * books into something that reads as a shelf, and the surplus goes to the two
 * ends instead, centring the row.
 */
const INTER_CLUSTER_GAP_MAX = 34;

export interface LayoutBookIn {
  /** Persisted slot index — only the ORDER matters to the layout. */
  slot: number;
  /** Spine width in world px. */
  w: number;
}

export interface LayoutBookOut {
  /** World-px center x of the spine on its floor. */
  centerX: number;
  /** Extra lean in degrees (0 for most books), + tilts the top rightward. */
  leanDeg: number;
}

/** Deterministic 32-bit seed for a floor's layout stream. */
function floorSeed(floorIndex: number): number {
  // Knuth multiplicative hash; floors 0,1,2… must not correlate.
  return ((floorIndex + 1) * 0x9e3779b1) >>> 0;
}

/** Split n books into k cluster sizes (each ≥ 1), consuming rnd. */
function clusterSizes(n: number, k: number, rnd: RandomFn): number[] {
  const sizes = new Array<number>(k).fill(1);
  let rest = n - k;
  // Deal the remainder one by one into seeded clusters — keeps sizes uneven
  // in a natural way (some fat clusters, some single standing books).
  while (rest > 0) {
    sizes[Math.floor(rnd() * k)] += 1;
    rest--;
  }
  return sizes;
}

/**
 * Lay out one floor. `items` must be sorted by slot (the store guarantees
 * this). Returns one placement per item, same order.
 */
export function layoutFloor(
  items: readonly LayoutBookIn[],
  floorIndex: number,
  shelfWidth: number = SHELF_WIDTH,
): LayoutBookOut[] {
  const n = items.length;
  if (n === 0) return [];
  const rnd = mulberry32(floorSeed(floorIndex));
  const avail = shelfWidth - 2 * LAYOUT_MARGIN_X;

  // --- cluster structure ---
  const k = Math.max(1, Math.min(4, n <= 2 ? 1 : 1 + Math.floor(n / 3.5) + (rnd() < 0.35 ? 1 : 0), n));
  const sizes = clusterSizes(n, k, rnd);

  // --- intra-cluster gaps (tight) and cluster widths ---
  const innerGaps: number[][] = [];
  const clusterW: number[] = [];
  let idx = 0;
  let totalW = 0;
  for (let c = 0; c < k; c++) {
    const gaps: number[] = [];
    let w = 0;
    for (let i = 0; i < (sizes[c] as number); i++) {
      const item = items[idx + i] as LayoutBookIn;
      w += item.w;
      if (i > 0) {
        const g = 1 + rnd() * 4;
        gaps.push(g);
        w += g;
      }
    }
    innerGaps.push(gaps);
    clusterW.push(w);
    totalW += w;
    idx += sizes[c] as number;
  }

  // --- distribute leftover width into the k+1 outer gaps ---
  //
  // Only SOME of it. Spreading every spare pixel across the row is what made
  // a lightly-filled floor read as islands of books floating in a wide case,
  // which is nothing like a shelf and nothing like the reference: real books
  // lean on each other and the empty part of the shelf stays in one piece.
  //
  // So each gap is capped, and whatever will not fit is left over at the
  // right-hand end, where it reads as room for more books rather than as
  // deliberate spacing.
  let free = avail - totalW;
  const outer = new Array<number>(k + 1).fill(0);
  if (free < 0) {
    // Pathologically full floor: compress inner gaps toward 1px, then clamp.
    free = 0;
  } else {
    // Seeded weights; the wall-side gaps get a smaller pull so clusters do
    // not hug the rails, and no single inter-cluster gap swallows the row.
    const weights: number[] = [];
    let wSum = 0;
    for (let g = 0; g <= k; g++) {
      const isEdge = g === 0 || g === k;
      const wt = (isEdge ? 0.55 : 1) * (0.4 + rnd());
      weights.push(wt);
      wSum += wt;
    }
    for (let g = 1; g < k; g++) {
      const share = (free * (weights[g] as number)) / wSum;
      outer[g] = Math.min(share, INTER_CLUSTER_GAP_MAX);
    }
    // Whatever the capped inner gaps did not take is split evenly between the
    // two ends, which centres the packed row in the case. Left-packing would
    // be just as truthful about a part-filled shelf, but it makes the case
    // look lopsided, and centring keeps the composition the old spread-out
    // layout was reaching for without scattering the books to get it.
    let used = 0;
    for (let g = 1; g < k; g++) used += outer[g] as number;
    const ends = Math.max(0, (free - used) / 2);
    outer[0] = ends;
    outer[k] = ends;
  }

  // --- emit centers ---
  const out: LayoutBookOut[] = [];
  let x = LAYOUT_MARGIN_X + (outer[0] as number);
  idx = 0;
  for (let c = 0; c < k; c++) {
    const gaps = innerGaps[c] as number[];
    for (let i = 0; i < (sizes[c] as number); i++) {
      const item = items[idx] as LayoutBookIn;
      if (i > 0) x += gaps[i - 1] as number;
      out.push({ centerX: x + item.w / 2, leanDeg: 0 });
      x += item.w;
      idx++;
    }
    x += outer[c + 1] as number;
  }

  // --- leaning books: edge-of-cluster books tip into a wide adjacent gap ---
  // Candidates walk cluster boundaries; lean direction points into the gap.
  interface LeanCandidate {
    bookIndex: number;
    dir: 1 | -1;
  }
  const candidates: LeanCandidate[] = [];
  let start = 0;
  for (let c = 0; c < k; c++) {
    const size = sizes[c] as number;
    const firstBook = start;
    const lastBook = start + size - 1;
    if ((outer[c] as number) >= LEAN_GAP_MIN && c > 0) {
      candidates.push({ bookIndex: firstBook, dir: -1 });
    }
    if ((outer[c + 1] as number) >= LEAN_GAP_MIN && c < k - 1) {
      candidates.push({ bookIndex: lastBook, dir: 1 });
    }
    start += size;
  }
  const leanCount = Math.min(
    candidates.length,
    n >= 5 ? (rnd() < 0.6 ? 1 : rnd() < 0.5 ? 2 : 0) : rnd() < 0.35 ? 1 : 0,
    MAX_LEANERS,
  );
  for (let i = 0; i < leanCount; i++) {
    const pick = Math.floor(rnd() * candidates.length);
    const cand = candidates.splice(pick, 1)[0] as LeanCandidate;
    const target = out[cand.bookIndex] as LayoutBookOut;
    if (target.leanDeg !== 0) continue;
    target.leanDeg = cand.dir * (LEAN_MIN_DEG + rnd() * (LEAN_MAX_DEG - LEAN_MIN_DEG));
  }

  return out;
}
