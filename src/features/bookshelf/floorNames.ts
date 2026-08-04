/**
 * features/bookshelf/floorNames.ts — editable brass-plaque labels per floor.
 *
 * Storage: one JSON blob in the `settings` table under the key 'floorNames'
 * (`{ "0": "Sciences", "3": "Arts" }`). No schema change needed; the settings
 * table is a generic key/value store (seed version + app settings already
 * live there). Values are trimmed and capped at 40 chars; empty string
 * deletes the entry (the plaque falls back to "Floor N").
 */

import { getDb } from '../../data/db';

export const FLOOR_NAMES_KEY = 'floorNames';

/** Max plaque label length (fits the engraved plate at bake size). */
export const FLOOR_NAME_MAX = 40;

type Listener = (floor: number, name: string | null) => void;

let cache: Map<number, string> | null = null;
let loadPromise: Promise<Map<number, string>> | null = null;
const listeners = new Set<Listener>();

/** Validate + normalize a raw stored blob into a floor→name map. */
export function parseFloorNames(raw: unknown): Map<number, string> {
  const map = new Map<number, string>();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return map;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const floor = Number.parseInt(key, 10);
    if (!Number.isInteger(floor) || floor < 0) continue;
    if (typeof value !== 'string') continue;
    const name = value.trim().slice(0, FLOOR_NAME_MAX);
    if (name.length > 0) map.set(floor, name);
  }
  return map;
}

/** Load (once) the floor-name map from the settings table. */
export function loadFloorNames(): Promise<Map<number, string>> {
  loadPromise ??= (async () => {
    const db = await getDb();
    let raw: unknown = null;
    try {
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [FLOOR_NAMES_KEY],
      );
      if (rows.length > 0) raw = JSON.parse(rows[0].value) as unknown;
    } catch {
      raw = null; // corrupt/missing blob -> empty map
    }
    cache = parseFloorNames(raw);
    return cache;
  })();
  return loadPromise;
}

/** Synchronous read from the cache (null until loadFloorNames resolves). */
export function floorNameSync(floor: number): string | null {
  return cache?.get(floor) ?? null;
}

/** Display label for a plaque: the stored name or "Floor N". */
export function floorLabel(floor: number): string {
  return floorNameSync(floor) ?? `Floor ${floor + 1}`;
}

/** Persist a floor name ('' or whitespace clears it) and notify listeners. */
export async function saveFloorName(
  floor: number,
  name: string,
): Promise<void> {
  const map = await loadFloorNames();
  const trimmed = name.trim().slice(0, FLOOR_NAME_MAX);
  if (trimmed.length === 0) map.delete(floor);
  else map.set(floor, trimmed);
  const blob: Record<string, string> = {};
  for (const [key, value] of map) blob[String(key)] = value;
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
    [FLOOR_NAMES_KEY, JSON.stringify(blob)],
  );
  for (const cb of listeners) cb(floor, trimmed.length > 0 ? trimmed : null);
}

/** Subscribe to plaque edits; returns an unsubscribe. */
export function onFloorNameChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

