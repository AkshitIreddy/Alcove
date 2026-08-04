/**
 * tests/support/fakeDom.ts — the smallest honest DOM the tour's watchers need.
 *
 * The suite runs in plain Node with no jsdom and none may be added
 * (vitest.config.ts says why), but two of the guided tour's modules are only
 * meaningful against a document: `src/features/tutorial/dismiss.ts` decides
 * which surfaces are standing and presses their own way out, and
 * `src/features/tutorial/probe.ts` decides whether a pointer drag landed on the
 * shelf. Both were written to be inert without a DOM, so the existing node
 * tests can only assert that they do NOTHING — which is exactly how a
 * questionnaire that outlived its step, and a shelf drag nobody heard, got
 * through a green suite.
 *
 * So: a handful of nodes, a real (small) selector matcher, and enough of
 * `window` to install a listener and fire an event at it. It is NOT a DOM
 * implementation — no layout, no CSS cascade, no event bubbling beyond
 * `closest`, no shadow anything. `visible: false` is a flag, not a computed
 * style. What it does support is the exact question those two modules ask:
 * "which of my selectors match, where are they in the tree, and did the reader
 * press this one".
 *
 * THE MATCHER THROWS on syntax it does not understand, deliberately. Both
 * modules swallow selector errors (a selector another feature renamed must not
 * break the tour), so a matcher that quietly returned `[]` would turn every
 * assertion here into a test that passes because nothing was found.
 */

/* ------------------------------- selectors -------------------------------- */

interface Compound {
  readonly tag: string | null;
  readonly classes: readonly string[];
  readonly attrs: readonly (readonly [string, string | null])[];
}

const TOKEN = /^(?:([a-zA-Z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\])/;

/** Parse one compound selector (`.a.b[c="d"]`). Throws on anything else. */
function parseCompound(source: string): Compound {
  let rest = source;
  let tag: string | null = null;
  const classes: string[] = [];
  const attrs: Array<readonly [string, string | null]> = [];
  while (rest.length > 0) {
    const m = TOKEN.exec(rest);
    if (m === null) throw new Error(`fakeDom: unsupported selector "${source}"`);
    if (m[1] !== undefined) tag = m[1].toUpperCase();
    else if (m[2] !== undefined) classes.push(m[2]);
    else attrs.push([m[3], m[4] ?? m[5] ?? null] as const);
    rest = rest.slice(m[0].length);
  }
  return { tag, classes, attrs };
}

/** A selector group: descendant combinators only, which is all the app uses. */
function parseGroup(source: string): readonly Compound[] {
  const parts = source.trim().split(/\s+/).filter((s) => s.length > 0);
  if (parts.length === 0) throw new Error('fakeDom: empty selector');
  return parts.map(parseCompound);
}

function parseSelector(source: string): readonly (readonly Compound[])[] {
  return source.split(',').map(parseGroup);
}

/* -------------------------------- elements -------------------------------- */

export interface FakeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FakeSpec {
  readonly tag?: string;
  /** Space-separated, exactly as it would be written in markup. */
  readonly class?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  /** Default true. False renders as `display: none` to `getComputedStyle`. */
  readonly visible?: boolean;
  /** Default a comfortable 400×300 at the origin — big enough to count. */
  readonly rect?: Partial<FakeRect>;
  readonly children?: readonly FakeSpec[];
}

export class FakeElement {
  readonly tagName: string;
  readonly classes: readonly string[];
  readonly attrs: Record<string, string>;
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  visible: boolean;
  rect: FakeRect;
  /** How many times this element's own `click()` has been called. */
  clicks = 0;
  /** `probe.coverFingerprint` reads this; nothing here needs it to be real. */
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};

  constructor(spec: FakeSpec) {
    this.tagName = (spec.tag ?? 'div').toUpperCase();
    this.classes = (spec.class ?? '').split(/\s+/).filter((s) => s.length > 0);
    this.attrs = { ...(spec.attrs ?? {}) };
    this.visible = spec.visible ?? true;
    this.rect = { x: 0, y: 0, width: 400, height: 300, ...(spec.rect ?? {}) };
    for (const child of spec.children ?? []) {
      const node = new FakeElement(child);
      node.parent = this;
      this.children.push(node);
    }
  }

  /** Depth-first, self included — the order a document tree is walked in. */
  *walk(): Generator<FakeElement> {
    yield this;
    for (const child of this.children) yield* child.walk();
  }

  private matchesCompound(c: Compound): boolean {
    if (c.tag !== null && c.tag !== this.tagName) return false;
    for (const name of c.classes) if (!this.classes.includes(name)) return false;
    for (const [name, value] of c.attrs) {
      const own = this.attrs[name];
      if (own === undefined) return false;
      if (value !== null && own !== value) return false;
    }
    return true;
  }

  /** Right-to-left, the way a browser matches descendant selectors. */
  private matchesGroup(group: readonly Compound[]): boolean {
    if (!this.matchesCompound(group[group.length - 1])) return false;
    let node: FakeElement | null = this.parent;
    for (let i = group.length - 2; i >= 0; i -= 1) {
      while (node !== null && !node.matchesCompound(group[i])) node = node.parent;
      if (node === null) return false;
      node = node.parent;
    }
    return true;
  }

  matches(selector: string): boolean {
    return parseSelector(selector).some((group) => this.matchesGroup(group));
  }

  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node !== null) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    for (const node of this.walk()) {
      if (node !== this && node.matches(selector)) out.push(node);
    }
    return out;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  contains(other: unknown): boolean {
    for (const node of this.walk()) if (node === other) return true;
    return false;
  }

  getBoundingClientRect(): FakeRect & { left: number; right: number; top: number; bottom: number } {
    const { x, y, width, height } = this.rect;
    return { x, y, width, height, left: x, right: x + width, top: y, bottom: y + height };
  }

  click(): void {
    this.clicks += 1;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
}

/* ------------------------------- the globals ------------------------------- */

type Listener = (event: unknown) => void;

export interface FakeDom {
  /** Every root passed to `installFakeDom`, in order. */
  readonly roots: readonly FakeElement[];
  /** First match anywhere in the document, or null. */
  find(selector: string): FakeElement | null;
  /** Fire an event at every capture-phase `window` listener for `type`. */
  fire(type: string, event: Record<string, unknown>): void;
}

const KEYS = ['window', 'document', 'getComputedStyle', 'Element', 'KeyboardEvent'] as const;
let saved: Partial<Record<(typeof KEYS)[number], unknown>> | null = null;

/**
 * Put a document on the global object. Always paired with `uninstallFakeDom()`
 * in an `afterEach` — every module under test reads `globalThis.document` at
 * call time, so a leak here would silently change what a later file asserts.
 */
export function installFakeDom(specs: readonly FakeSpec[]): FakeDom {
  const roots = specs.map((spec) => new FakeElement(spec));
  const listeners = new Map<string, Listener[]>();
  const documentElement = new FakeElement({ tag: 'html' });

  const all = (): FakeElement[] => roots.flatMap((root) => [...root.walk()]);
  const queryAll = (selector: string): FakeElement[] =>
    all().filter((node) => node.matches(selector));

  const target = globalThis as unknown as Record<string, unknown>;
  saved = {};
  for (const key of KEYS) saved[key] = target[key];

  target.Element = FakeElement;
  class FakeKeyboardEvent {
    readonly type: string;
    readonly key: string;
    constructor(type: string, init: { key?: string } = {}) {
      this.type = type;
      this.key = init.key ?? '';
    }
  }
  target.KeyboardEvent = FakeKeyboardEvent;
  target.getComputedStyle = (node: FakeElement) => ({
    visibility: node.visible ? 'visible' : 'hidden',
    display: node.visible ? 'block' : 'none',
    opacity: node.visible ? '1' : '0',
  });
  target.document = {
    documentElement,
    querySelectorAll: queryAll,
    querySelector: (selector: string) => queryAll(selector)[0] ?? null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  };
  target.window = {
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener: (type: string, fn: Listener) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, fn: Listener) => {
      const list = (listeners.get(type) ?? []).filter((f) => f !== fn);
      listeners.set(type, list);
    },
    matchMedia: () => ({ matches: false }),
  };

  return {
    roots,
    find: (selector: string) => queryAll(selector)[0] ?? null,
    fire: (type, event) => {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

/** Put the real (absent) globals back. */
export function uninstallFakeDom(): void {
  if (saved === null) return;
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of KEYS) {
    if (saved[key] === undefined) delete target[key];
    else target[key] = saved[key];
  }
  saved = null;
}
