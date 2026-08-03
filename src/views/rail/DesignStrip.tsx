/**
 * src/views/rail/DesignStrip.tsx — one axis, shown small, and the shape every
 * long list in the app now borrows.
 *
 * The shape the reader asked for: a handful of real previews inline, and a way
 * through to the rest. Eight tiles and a "more…" cell make a tidy three-across
 * block, which is as many as fit in a 376px sheet while still being big enough
 * to tell a gothic arcade from a pigeonhole grid.
 *
 * The eight are the head of the vocabulary — the lists are already ordered
 * plain → ornate, which is the order somebody shops in — except that the
 * CURRENT choice is always among them. Without that the strip would show no
 * pressed tile the moment you picked something from the long sheet, and the
 * row would read as though your choice had been forgotten.
 *
 * That rule turned out not to be about strips at all, so the bottom half of
 * this file is now the general form of it — `cappedTo`, `MoreControl`,
 * `Capped` — and the strip is its first customer. Anything in the app with
 * more rows than a reader wants at once should reach for those three rather
 * than write a fourth copy: the catalogue's shelves and the picker sheet both
 * do, and the count on the control is the REMAINING count, never the total.
 * "60 more…" over a row that already shows eight of the sixty is a lie the
 * reader can check.
 *
 * The same thing has now happened twice. The reader's curation — remove an
 * entry, star it once for the top of its family or twice for the top of the
 * whole list, right-click to get a removal back — is not a strip feature
 * either, so the middle of this file is `createCuration`: one controller that
 * turns an axis name into a curated list, a right-click menu, a restore drawer
 * and a way to keep what you have. The strip and the picker sheet are both its
 * customers and neither knows how any of it works. `src/data/shelfOfMine.ts`
 * is the store underneath and the place the reasoning lives.
 */
import {
  Index,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import type { FlatScheme } from '../../art/flat';
import {
  curateList,
  getSavedRoom,
  hiddenIds,
  hideEntry,
  isHidden,
  loadShelfOfMine,
  restoreAll,
  restoreEntries,
  setStars,
  starsOf,
  type CurationAxis,
  type Stars,
} from '../../data/shelfOfMine';
import { DesignCanvas } from './designArt';
import type { PickerOption } from './DesignPicker';
import '../../styles/curation.css';

/* ========================================================================== *
 *                     the shared shape: a head, and the rest                 *
 * ========================================================================== */

/**
 * How many rows a panel shows before it offers the rest.
 *
 * One number, because the reader asked for one behaviour ("after like 20")
 * across the whole app, and because a per-panel constant is a per-panel thing
 * to forget. Strips override it downward — a tile is 104px wide and eight is
 * all that fits — and the picker sheet overrides it upward, since its cards
 * are what the reader came for.
 */
export const CAP = 20;

/**
 * The head of a list, with the reader's current choice guaranteed to be in it.
 *
 * The guarantee is the whole point. Cap a list at twenty, let somebody pick the
 * fortieth from the expanded view, collapse it again, and every tile comes back
 * unpressed — which reads as "it forgot", not as "it is further down". So the
 * active row is swapped into the LAST slot of the head rather than the first:
 * the head is ordered, and pushing the whole run along to make room at the
 * front would move every tile out from under the reader's cursor.
 *
 * Pass no `isActive` when the list is a SEARCH RESULT. Pinning a row the query
 * did not match into a list of hits is a different lie: the reader typed a
 * word and got back something that does not contain it.
 */
export function cappedTo<T>(
  all: readonly T[],
  limit: number,
  isActive?: (item: T) => boolean,
): readonly T[] {
  if (limit < 1 || all.length <= limit) return all;
  const head = all.slice(0, limit);
  if (isActive === undefined || head.some(isActive)) return head;
  const active = all.find(isActive);
  return active === undefined ? head : [...head.slice(0, limit - 1), active];
}

export interface MoreControlProps {
  /** How many rows are NOT on screen. Never the total. */
  hidden: number;
  open: boolean;
  /** What is being revealed, for the screen reader: "tape", "wallpapers". */
  label: string;
  onToggle(): void;
  /** Extra class, so each host can dress the control as one of its own cells. */
  class?: string;
}

/** "37 more" / "show fewer" — the one control for "there is more behind this". */
export function MoreControl(props: MoreControlProps): JSX.Element {
  return (
    <button
      type="button"
      class={props.class === undefined ? 'nb-more' : `nb-more ${props.class}`}
      aria-expanded={props.open}
      aria-label={
        props.open ? `${props.label}: show fewer` : `${props.label}: show ${props.hidden} more`
      }
      onClick={() => props.onToggle()}
    >
      <Show
        when={!props.open}
        fallback={<span class="nb-more-word">show fewer</span>}
      >
        <span class="nb-more-count">{props.hidden}</span>
        <span class="nb-more-word">more</span>
      </Show>
    </button>
  );
}

export interface CappedProps<T> {
  each: readonly T[];
  /** Rows before the control. Defaults to `CAP`. */
  limit?: number;
  /** The reader's current choice, which is always shown. See `cappedTo`. */
  isActive?: (item: T) => boolean;
  /** What the control is revealing, for the screen reader. */
  label: string;
  /** Extra class on the control. */
  moreClass?: string;
  /**
   * Collapse again whenever this value changes — a new search, a new shelf.
   * Read reactively, so pass the value itself, not an accessor.
   */
  resetKey?: unknown;
  children: (item: () => T) => JSX.Element;
}

/**
 * A flat list, capped, with its own reveal control. Returns a FRAGMENT, so the
 * host's grid keeps owning the layout and the control lands in it as one more
 * cell.
 *
 * `Index`, not `For`. The rows these lists carry are rebuilt whenever anything
 * upstream changes — a pick, a keystroke in the search box — and a reference-
 * keyed `For` would throw away and re-create every button, taking the reader's
 * focus and their scroll position with it. That lesson was learned in
 * DesignPicker and it applies to every one of these.
 */
export function Capped<T>(props: CappedProps<T>): JSX.Element {
  const [open, setOpen] = createSignal(false);

  createEffect(() => {
    // Read, do not use: the read is the subscription.
    void props.resetKey;
    setOpen(false);
  });

  const shown = (): readonly T[] =>
    open() ? props.each : cappedTo(props.each, props.limit ?? CAP, props.isActive);
  const hidden = (): number => props.each.length - shown().length;

  return (
    <>
      <Index each={shown()}>{(item) => props.children(item)}</Index>
      <Show when={open() || hidden() > 0}>
        <MoreControl
          class={props.moreClass}
          hidden={hidden()}
          open={open()}
          label={props.label}
          onToggle={() => setOpen(!open())}
        />
      </Show>
    </>
  );
}

/* ========================================================================== *
 *                    the reader's own hand: stars and removals               *
 * ========================================================================== */

/** The gilt plate a starred entry wears. A span, so it can sit in a button. */
export function StarMark(props: { stars: Stars }): JSX.Element {
  return (
    <Show when={props.stars > 0}>
      <span
        class="nb-mark"
        classList={{ 'is-double': props.stars === 2 }}
        aria-hidden="true"
      >
        {props.stars === 2 ? '★★' : '★'}
      </span>
    </Show>
  );
}

/** Said out loud in an aria-label, so the mark is not gold-only information. */
export function starWords(stars: Stars): string {
  if (stars === 2) return ' — starred twice, first of them all';
  if (stars === 1) return ' — starred, first in its family';
  return '';
}

/** Everything `createCuration` needs, read fresh so it tracks its caller. */
export interface CurationHost {
  /**
   * Which list this is. Omit and every part of this controller stands down —
   * the options pass through untouched and right-click means what it meant
   * before. That is what lets an axis opt in with one prop.
   */
  axis?: CurationAxis;
  /** The list's name, in the reader's words: "room presets", "wallpaper". */
  label: string;
  /** The FULL list, before curation. The drawer needs names for removed ids. */
  options: readonly PickerOption[];
  activeId: string;
  /**
   * Offered as "keep what you have…" in the menu, with a name and a star
   * level. Only lists whose current state is not itself an entry want this —
   * the room, whose four axes may sit on no named preset at all.
   */
  onSaveCurrent?(name: string, stars: Stars): void;
  /** What that menu item is called. Default: "keep what you have…". */
  saveLabel?: string;
  /** Placeholder in the name box. Default: "name it…". */
  savePlaceholder?: string;
}

interface MenuAt {
  x: number;
  y: number;
  /** The entry right-clicked, or null for the list's own background. */
  id: string | null;
}

/** Rough menu box, used only to keep it inside the window. */
const MENU_W = 226;
const MENU_H = 240;

/**
 * One axis's curation: the arranged list, the right-click menu, the restore
 * drawer, and the form that keeps what the reader has.
 *
 * A factory rather than a component because the two callers lay their lists out
 * completely differently — a three-across grid of 104px tiles and a two-across
 * sheet of 148px cards — and the only things they can share are the list, the
 * handlers and the furniture that hangs off the side. `Overlay` is the
 * furniture; the host decides where it lands, which for both of them is
 * directly under the list so the drawer is obviously attached to it.
 */
export function createCuration(host: () => CurationHost): {
  /** The list as the reader has arranged it. Identity when no axis is named. */
  list(): readonly PickerOption[];
  starsFor(id: string): Stars;
  removed(id: string): boolean;
  /** Right-click on one entry. */
  onEntryContext(event: MouseEvent, id: string): void;
  /** Right-click on the list itself — opens the restore drawer. */
  onListContext(event: MouseEvent): void;
  Overlay(): JSX.Element;
} {
  const [menu, setMenu] = createSignal<MenuAt | null>(null);
  const [drawer, setDrawer] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [ticked, setTicked] = createSignal<readonly string[]>([]);
  const [name, setName] = createSignal('');
  const [saveStars, setSaveStars] = createSignal<Stars>(0);
  let menuEl: HTMLDivElement | undefined;

  // Every panel that shows a curated list calls this; it is idempotent, and
  // without it the first paint would show an uncurated list for one frame.
  onMount(() => {
    void loadShelfOfMine();
  });

  const axis = (): CurationAxis | undefined => host().axis;
  const live = (): boolean => host().axis !== undefined;

  const list = (): readonly PickerOption[] => {
    const a = axis();
    return a === undefined ? host().options : curateList(a, host().options, host().activeId);
  };

  const starsFor = (id: string): Stars => {
    const a = axis();
    return a === undefined ? 0 : starsOf(a, id);
  };

  const removed = (id: string): boolean => {
    const a = axis();
    return a === undefined ? false : isHidden(a, id);
  };

  const gone = (): readonly string[] => {
    const a = axis();
    return a === undefined ? [] : hiddenIds(a);
  };

  /** What a removed id was called, if the vocabulary still knows. */
  const nameOf = (id: string): string | null => {
    const found = host().options.find((option) => option.id === id);
    if (found !== undefined) return found.name;
    // A room the reader saved and then removed is still theirs to name, even
    // if the list it belongs to has not been handed to us with it.
    return getSavedRoom(id)?.name ?? null;
  };

  /** Which family a starred entry would go to the head of. */
  const familyOf = (id: string): string =>
    host().options.find((option) => option.id === id)?.group ?? '';

  const closeAll = (): void => {
    setMenu(null);
    setDrawer(false);
    setSaving(false);
  };

  const openMenu = (event: MouseEvent, id: string | null): void => {
    if (!live()) return;
    event.preventDefault();
    event.stopPropagation();
    setDrawer(false);
    setSaving(false);
    setMenu({
      x: Math.max(4, Math.min(event.clientX, window.innerWidth - MENU_W - 4)),
      y: Math.max(4, Math.min(event.clientY, window.innerHeight - MENU_H - 4)),
      id,
    });
  };

  /*
   * Escape, a press outside, or any scroll closes the menu.
   *
   * `pointerdown` in the BUBBLE phase, and only when the press landed outside
   * the menu's own element: at capture it fires before the click reaches a menu
   * item, so every item in the menu became unclickable — which looked exactly
   * like a menu that did nothing.
   */
  createEffect(() => {
    if (menu() === null) return;
    const away = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && menuEl?.contains(target) === true) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The rail panel closes on Escape too; the menu is on top, so it eats it.
      event.stopPropagation();
      setMenu(null);
    };
    // A named function, not an inline arrow, so `onCleanup` can actually take
    // it off again: an anonymous listener added per menu-open is a listener
    // per menu-open, forever, each one firing on every scroll of a panel that
    // scrolls constantly.
    const onScroll = (): void => {
      setMenu(null);
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    onCleanup(() => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    });
  });

  const openDrawer = (): void => {
    setTicked([]);
    setMenu(null);
    setSaving(false);
    setDrawer(true);
  };

  const openSave = (): void => {
    setName('');
    setSaveStars(0);
    setMenu(null);
    setDrawer(false);
    setSaving(true);
  };

  const tick = (id: string, on: boolean): void => {
    setTicked((current) =>
      on ? [...current.filter((each) => each !== id), id] : current.filter((each) => each !== id),
    );
  };

  const putBack = (ids: readonly string[]): void => {
    const a = axis();
    if (a === undefined || ids.length === 0) return;
    void restoreEntries(a, ids);
    setTicked([]);
    // Emptying the drawer closes it: a panel that stays open on an empty list
    // after you asked for everything back is a panel asking to be closed twice.
    if (ids.length >= gone().length) setDrawer(false);
  };

  const keepIt = (): void => {
    const clean = name().trim();
    if (clean === '') return;
    host().onSaveCurrent?.(clean, saveStars());
    setSaving(false);
    setName('');
  };

  /* ------------------------------- the menu ------------------------------ */

  const MenuItem = (props: {
    stars?: string;
    on?: boolean;
    away?: boolean;
    disabled?: boolean;
    onClick(): void;
    children: JSX.Element;
  }): JSX.Element => (
    <button
      type="button"
      role="menuitem"
      class="nb-cur-menu-item"
      classList={{ 'is-on': props.on === true, 'is-away': props.away === true }}
      disabled={props.disabled === true}
      onClick={() => props.onClick()}
    >
      <Show when={props.stars !== undefined}>
        <span class="nb-cur-menu-stars" aria-hidden="true">
          {props.stars}
        </span>
      </Show>
      <span>{props.children}</span>
    </button>
  );

  const Menu = (props: { at: MenuAt }): JSX.Element => {
    const id = (): string | null => props.at.id;
    const stars = (): Stars => (id() === null ? 0 : starsFor(id()!));
    const family = (): string => (id() === null ? '' : familyOf(id()!));
    const inUse = (): boolean => id() !== null && id() === host().activeId;

    return (
      <div
        ref={(el) => (menuEl = el)}
        class="nb-cur-menu"
        role="menu"
        aria-label={`${host().label}: this one`}
        style={{ left: `${props.at.x}px`, top: `${props.at.y}px` }}
      >
        <Show when={id() !== null}>
          <p class="nb-cur-menu-name">{nameOf(id()!) ?? id()}</p>
          <MenuItem
            stars="★"
            on={stars() === 1}
            onClick={() => {
              void setStars(axis()!, id()!, stars() === 1 ? 0 : 1);
              setMenu(null);
            }}
          >
            {family() === ''
              ? 'first in this list'
              : `first in ${family().toLowerCase()}`}
          </MenuItem>
          <MenuItem
            stars="★★"
            on={stars() === 2}
            onClick={() => {
              void setStars(axis()!, id()!, stars() === 2 ? 0 : 2);
              setMenu(null);
            }}
          >
            first of them all
          </MenuItem>
          <div class="nb-cur-menu-sep" />
          <MenuItem
            away
            disabled={inUse() || removed(id()!)}
            onClick={() => {
              void hideEntry(axis()!, id()!);
              setMenu(null);
            }}
          >
            {inUse()
              ? 'you are using this one'
              : removed(id()!)
                ? 'already removed'
                : 'remove from the list'}
          </MenuItem>
          <div class="nb-cur-menu-sep" />
        </Show>
        <MenuItem onClick={openDrawer}>
          {gone().length === 0 ? 'nothing removed yet' : `removed (${gone().length})…`}
        </MenuItem>
        <Show when={host().onSaveCurrent !== undefined}>
          <MenuItem onClick={openSave}>
            {host().saveLabel ?? 'keep what you have…'}
          </MenuItem>
        </Show>
      </div>
    );
  };

  /* ------------------------------ the drawer ----------------------------- */

  /**
   * Both panels open BELOW the list, which is right under a strip and a very
   * long way under a sheet of twenty-four cards. Without this the reader picks
   * "removed…" at the top of the picker and nothing appears to happen.
   */
  const bringIntoView = (el: HTMLElement): void => {
    queueMicrotask(() => el.scrollIntoView({ block: 'nearest' }));
  };

  const DrawerHead = (props: { title: string }): JSX.Element => (
    <div class="nb-cur-drawer-head">
      {/* The way out, top-left of the thing it leaves. See
          tests/top-left-exits.test.ts and .nb-cur-drawer-close. */}
      <button
        type="button"
        class="nb-cur-drawer-close"
        aria-label="close"
        data-tooltip="close"
        onClick={closeAll}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <g
            fill="none"
            stroke="currentColor"
            stroke-width="2.6"
            stroke-linecap="round"
          >
            <path d="M5.4 5.8 L18.3 18.1" />
            <path d="M18.4 5.6 L5.6 18.3" />
          </g>
        </svg>
      </button>
      <h4 class="nb-cur-drawer-title">{props.title}</h4>
    </div>
  );

  const Drawer = (): JSX.Element => (
    <div class="nb-cur-drawer" ref={bringIntoView}>
      <DrawerHead title={`removed from ${host().label.toLowerCase()}`} />
      <Show
        when={gone().length > 0}
        fallback={
          <p class="nb-cur-note">
            nothing removed from {host().label.toLowerCase()} yet. right-click any
            one of them to put it away — it comes back here, and only here, so
            nothing you take off a list is ever actually gone.
          </p>
        }
      >
        <div class="nb-cur-list" role="group" aria-label={`removed ${host().label}`}>
          <Capped
            each={gone()}
            label={`removed ${host().label}`}
            moreClass="nb-cur-more"
            resetKey={host().label}
          >
            {(id) => (
              <label class="nb-cur-row">
                <input
                  type="checkbox"
                  checked={ticked().includes(id())}
                  onChange={(event) => tick(id(), event.currentTarget.checked)}
                />
                <span
                  class="nb-cur-row-name"
                  classList={{ 'nb-cur-row-orphan': nameOf(id()) === null }}
                >
                  {nameOf(id()) ?? id()}
                </span>
              </label>
            )}
          </Capped>
        </div>
        <div class="nb-cur-actions">
          <button
            type="button"
            class="nb-cur-btn is-primary"
            disabled={ticked().length === 0}
            onClick={() => putBack(ticked())}
          >
            put {ticked().length === 0 ? '' : `${ticked().length} `}back
          </button>
          <button
            type="button"
            class="nb-cur-btn"
            onClick={() => {
              const a = axis();
              if (a === undefined) return;
              void restoreAll(a);
              setTicked([]);
              setDrawer(false);
            }}
          >
            all of them
          </button>
        </div>
      </Show>
    </div>
  );

  /* ------------------------------ keeping one ---------------------------- */

  const SaveForm = (): JSX.Element => (
    <div class="nb-cur-drawer" ref={bringIntoView}>
      <DrawerHead title={host().saveLabel ?? 'keep what you have'} />
      <div class="nb-cur-form">
        <input
          class="nb-cur-input"
          type="text"
          value={name()}
          maxLength={48}
          autocomplete="off"
          spellcheck={false}
          placeholder={host().savePlaceholder ?? 'name it…'}
          aria-label="name"
          ref={(el) => queueMicrotask(() => el.focus())}
          onInput={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') keepIt();
            if (event.key === 'Escape') setSaving(false);
          }}
        />
        {/* The reader asked to save and star in one action, so the stars are
            here rather than a second trip through the menu afterwards. */}
        <div class="nb-cur-stars" role="group" aria-label="star it">
          <Index each={[0, 1, 2] as const}>
            {(level) => (
              <button
                type="button"
                class="nb-cur-star-btn"
                classList={{ 'is-on': saveStars() === level() }}
                aria-pressed={saveStars() === level()}
                aria-label={
                  level() === 0
                    ? 'no star'
                    : level() === 1
                      ? 'one star: first in its family'
                      : 'two stars: first of them all'
                }
                onClick={() => setSaveStars(level() as Stars)}
              >
                {level() === 0 ? '—' : level() === 1 ? '★' : '★★'}
              </button>
            )}
          </Index>
          <span class="nb-cur-star-hint">
            {saveStars() === 2
              ? 'first of them all'
              : saveStars() === 1
                ? 'first in its family'
                : 'no star'}
          </span>
        </div>
        <div class="nb-cur-actions">
          <button
            type="button"
            class="nb-cur-btn is-primary"
            disabled={name().trim() === ''}
            onClick={keepIt}
          >
            keep it
          </button>
        </div>
      </div>
    </div>
  );

  const Overlay = (): JSX.Element => (
    <Show when={live()}>
      <Show when={menu()}>{(at) => <Menu at={at()} />}</Show>
      <Show when={drawer()}>
        <Drawer />
      </Show>
      <Show when={saving()}>
        <SaveForm />
      </Show>
    </Show>
  );

  return {
    list,
    starsFor,
    removed,
    onEntryContext: (event, id) => openMenu(event, id),
    onListContext: (event) => openMenu(event, null),
    Overlay,
  };
}

/* ========================================================================== *
 *                                  the strip                                 *
 * ========================================================================== */

export interface DesignStripProps {
  /** Accessible name for the group — "Bookcase build", "Wallpaper". */
  label: string;
  options: readonly PickerOption[];
  activeId: string;
  scheme: FlatScheme;
  onPick(id: string): void;
  /**
   * Opens the long sheet. Omit for a SHORT vocabulary that fits whole — the
   * five wallpaper scales, the four reliefs — where a "more…" cell leading to
   * the same five options would be a lie about how much there is.
   */
  onMore?(): void;
  tileW?: number;
  tileH?: number;
  columns?: number;
  /** How many previews before the "more…" cell. Default 8 (a 3x3 block). */
  limit?: number;
  /** Caption each tile. On for short rows, off when the tiles are the point. */
  showNames?: boolean;
  /**
   * Name this axis and the whole of the reader's curation arrives: their
   * removals are taken out, their stars order what is left, right-clicking a
   * tile offers both, and right-clicking the strip opens what they removed.
   * Omit it and this component is exactly what it was.
   */
  axis?: CurationAxis;
  /** Offer "keep what you have…" in the right-click menu. See CurationHost. */
  onSaveCurrent?(name: string, stars: Stars): void;
  saveLabel?: string;
  savePlaceholder?: string;
}

export default function DesignStrip(props: DesignStripProps): JSX.Element {
  const limit = (): number => props.limit ?? 8;
  const columns = (): number => props.columns ?? 3;

  const curation = createCuration(() => ({
    axis: props.axis,
    label: props.label,
    options: props.options,
    activeId: props.activeId,
    onSaveCurrent: props.onSaveCurrent,
    saveLabel: props.saveLabel,
    savePlaceholder: props.savePlaceholder,
  }));

  /** The list as the reader arranged it — identity when no axis was named. */
  const all = (): readonly PickerOption[] => curation.list();

  const shown = (): readonly PickerOption[] =>
    props.onMore === undefined
      ? all()
      : cappedTo(all(), limit(), (o) => o.id === props.activeId);

  /** What the "more…" cell is actually offering. Never the total — see above. */
  const hidden = (): number => all().length - shown().length;

  return (
    <>
      <div
        class="nb-strip"
        role="group"
        aria-label={props.label}
        style={{ '--nb-strip-cols': String(columns()) }}
        on:contextmenu={(event) => curation.onListContext(event)}
      >
        {/* Index, not For — see DesignPicker: a pick rebuilds the option list,
            and reference keying would re-create every tile under the cursor. */}
        <Index each={shown()}>
          {(option) => (
            <button
              type="button"
              class="nb-strip-tile"
              classList={{
                'is-active': option().id === props.activeId,
                'nb-cur-gone': curation.removed(option().id),
              }}
              aria-pressed={option().id === props.activeId}
              aria-label={`${option().name} — ${option().blurb}${starWords(
                curation.starsFor(option().id),
              )}`}
              data-tooltip={`${option().name} — ${option().blurb}`}
              onClick={() => props.onPick(option().id)}
              on:contextmenu={(event) => curation.onEntryContext(event, option().id)}
            >
              {/* The wrapper is the star's positioning context. See
                  curation.css: adding `position: relative` to the tile from
                  another file would be two rules fighting over one selector. */}
              <span class="nb-mark-wrap">
                <DesignCanvas
                  class="nb-strip-art"
                  key={option().artKey}
                  w={props.tileW ?? 104}
                  h={props.tileH ?? 72}
                  scheme={props.scheme}
                  draw={(ctx, w, h) => option().draw(ctx, w, h)}
                />
                <StarMark stars={curation.starsFor(option().id)} />
              </span>
              <Show when={props.showNames === true}>
                <span class="nb-strip-name">{option().name}</span>
              </Show>
            </button>
          )}
        </Index>
        <Show when={props.onMore !== undefined && hidden() > 0}>
          <button
            type="button"
            class="nb-strip-tile nb-strip-more"
            onClick={() => props.onMore?.()}
            aria-label={`${props.label}: browse all ${all().length}`}
          >
            <span class="nb-strip-more-count">{hidden()}</span>
            <span class="nb-strip-more-word">more…</span>
          </button>
        </Show>
      </div>
      <curation.Overlay />
    </>
  );
}
