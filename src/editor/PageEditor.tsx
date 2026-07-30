/**
 * PageEditor — one TipTap editor per page.
 *
 * - Debounced (400ms) savePageDoc on every update; flushed on unmount.
 * - Document carries pageStyle ('ruled'|'grid'|'blank'|'dotted') and
 *   lineHeightPx attrs; the page background CSS renders them (editor.css).
 * - Line-level drag handles (hand-drawn grip) + GSAP Flip settle on drop.
 *
 * Props are read once at mount (an editor instance is not hot-swappable);
 * remount with a keyed <Show>/<For> when the page changes.
 */
import type { JSONContent } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { Slice } from '@tiptap/pm/model';
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { createEffect, For, onCleanup, type JSX } from 'solid-js';
import { savePageDoc } from '../data/pages';
import type { PageDoc, PageStyle } from '../data/types';
import {
  DEFAULT_LINE_HEIGHT_PX,
  DEFAULT_PAGE_STYLE,
  PAGE_STYLES,
  isPageStyle,
  normalizePageDoc,
} from './document';
import { createEditorExtensions } from './extensions';
import { setActiveEditor } from './insert/activeEditor';
import { createMediaPastePlugin } from './media';
import { createEditorTransaction, createTiptapEditor } from './solid';
import { play } from '../sound/engine';
import { settings } from '../data/settings';
import { burstConfetti } from './effects/confetti';
import { mountMarginDoodles } from './effects/doodles';
import '../styles/effects.css';

/**
 * Soft pencil-tick when a todo checkbox is checked (delegated per page root)
 * — plus a confetti burst from the checkbox when the user opted in.
 */
function onTaskToggle(event: Event): void {
  const target = event.target;
  if (
    target instanceof HTMLInputElement &&
    target.type === 'checkbox' &&
    target.closest('li[data-checked]') !== null &&
    target.checked
  ) {
    void play('check-done');
    if (settings.confettiOnComplete && !settings.minimalistMode) {
      const rect = target.getBoundingClientRect();
      burstConfetti({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
      void play('confetti');
    }
  }
}

gsap.registerPlugin(Flip);

export interface PageEditorProps {
  readonly pageId: string;
  readonly initialDoc: PageDoc;
}

const SAVE_DEBOUNCE_MS = 400;

/** Respect reduced-motion: tokens.css zeroes --motion-scale. */
function motionScale(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--motion-scale')
    .trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 1;
}

/** Hand-drawn grip: six slightly-scattered graphite dots. */
function buildDragHandleElement(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'nb-drag-handle';
  element.setAttribute('aria-hidden', 'true');
  element.innerHTML =
    '<svg viewBox="0 0 14 22" xmlns="http://www.w3.org/2000/svg">' +
    '<g fill="var(--ink-graphite-soft)">' +
    '<circle cx="4.2" cy="4.4" r="1.7"/><circle cx="10" cy="3.8" r="1.6"/>' +
    '<circle cx="3.8" cy="11.2" r="1.6"/><circle cx="10.2" cy="10.8" r="1.7"/>' +
    '<circle cx="4.4" cy="17.8" r="1.7"/><circle cx="9.8" cy="18.2" r="1.6"/>' +
    '</g></svg>';
  return element;
}

function topLevelBlocks(view: EditorView): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(view.dom.children)) {
    if (child instanceof HTMLElement && child.hasAttribute('data-id')) {
      // Flip matches old/new elements by data-flip-id.
      child.setAttribute('data-flip-id', child.getAttribute('data-id') ?? '');
      blocks.push(child);
    }
  }
  return blocks;
}

const PAGE_STYLE_LABELS: Record<PageStyle, string> = {
  ruled: 'Ruled lines',
  grid: 'Grid squares',
  dotted: 'Dot grid',
  blank: 'Blank paper',
};

export default function PageEditor(props: PageEditorProps): JSX.Element {
  let mountElement!: HTMLDivElement;
  let pageRootElement!: HTMLDivElement;

  // -------------------------------------------------------------------------
  // Debounced persistence
  // -------------------------------------------------------------------------
  const pageId = props.pageId;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingDoc: PageDoc | null = null;

  const flushSave = (): void => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (pendingDoc !== null) {
      const doc = pendingDoc;
      pendingDoc = null;
      void savePageDoc(pageId, doc);
    }
  };

  const scheduleSave = (doc: PageDoc): void => {
    pendingDoc = doc;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };

  onCleanup(flushSave);

  // -------------------------------------------------------------------------
  // GSAP Flip reorder settle (doc §7): capture block positions before the
  // drop transaction mutates the DOM, animate transforms after.
  // -------------------------------------------------------------------------
  const handleDrop = (
    view: EditorView,
    _event: DragEvent,
    _slice: Slice,
    moved: boolean,
  ): boolean => {
    const scale = motionScale();
    if (!moved || scale <= 0) return false;
    const state = Flip.getState(topLevelBlocks(view));
    // ProseMirror applies the drop synchronously in this task; the microtask
    // runs right after, with the DOM already reordered.
    queueMicrotask(() => {
      Flip.from(state, {
        targets: topLevelBlocks(view),
        duration: 0.4 * scale,
        ease: 'power3.out',
      });
    });
    return false; // let ProseMirror handle the actual drop
  };

  // -------------------------------------------------------------------------
  // Editor
  // -------------------------------------------------------------------------
  const editor = createTiptapEditor(() => ({
    element: mountElement,
    extensions: createEditorExtensions({
      interactive: true,
      placeholder: 'Type / for commands…',
      dragHandle: { render: buildDragHandleElement },
    }),
    // PageDoc's content is unknown[] on purpose (the data layer only owns the
    // envelope); the schema validates the deep shape when the editor parses it.
    content: normalizePageDoc(props.initialDoc) as JSONContent,
    editorProps: {
      attributes: { class: 'nb-prose', spellcheck: 'true' },
      handleDrop,
    },
    onUpdate: ({ editor: instance }) => {
      scheduleSave(instance.getJSON() as PageDoc);
    },
  }));

  // Publish the live editor for the script toolbar/dialog + install the media
  // paste/drop plugin (once per instance).
  let mediaPluginInstalled: unknown = null;
  createEffect(() => {
    const instance = editor();
    setActiveEditor(instance ?? null);
    if (instance && mediaPluginInstalled !== instance) {
      instance.registerPlugin(createMediaPastePlugin());
      mediaPluginInstalled = instance;
    }
  });
  onCleanup(() => setActiveEditor(null));

  // -------------------------------------------------------------------------
  // Page style (doc attrs → background CSS)
  // -------------------------------------------------------------------------
  const pageStyle = createEditorTransaction(editor, (instance): PageStyle => {
    const value: unknown = instance?.state.doc.attrs.pageStyle;
    return isPageStyle(value) ? value : DEFAULT_PAGE_STYLE;
  });

  const lineHeightPx = createEditorTransaction(editor, (instance): number => {
    const value: unknown = instance?.state.doc.attrs.lineHeightPx;
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : DEFAULT_LINE_HEIGHT_PX;
  });

  const setPageStyle = (style: PageStyle): void => {
    const instance = editor();
    if (!instance || pageStyle() === style) return;
    instance.view.dispatch(
      instance.state.tr.setDocAttribute('pageStyle', style),
    );
  };

  // -------------------------------------------------------------------------
  // Margin doodles — deterministic pencil sketches, seeded by pageId.
  // Mounted only when the user wants them (settings are reactive; the
  // nb-minimalist/nb-no-doodles root classes hide them as a CSS backstop).
  // -------------------------------------------------------------------------
  let doodleCleanup: (() => void) | undefined;
  createEffect(() => {
    const show = settings.showMarginDoodles && !settings.minimalistMode;
    doodleCleanup?.();
    doodleCleanup = undefined;
    if (show) doodleCleanup = mountMarginDoodles(pageRootElement, pageId);
  });
  onCleanup(() => {
    doodleCleanup?.();
    doodleCleanup = undefined;
  });

  return (
    <div
      class="nb-page"
      data-style={pageStyle()}
      style={{ '--page-line-height': `${lineHeightPx()}px` }}
      ref={(el) => {
        pageRootElement = el;
        el.addEventListener('change', onTaskToggle);
      }}
    >
      <nav class="nb-style-switcher" aria-label="Page style">
        <For each={PAGE_STYLES}>
          {(style) => (
            <button
              type="button"
              class="nb-style-choice font-ui"
              classList={{ 'is-active': pageStyle() === style }}
              title={PAGE_STYLE_LABELS[style]}
              aria-label={PAGE_STYLE_LABELS[style]}
              aria-pressed={pageStyle() === style}
              onClick={() => setPageStyle(style)}
            >
              <span class="nb-style-dot" data-style={style} aria-hidden="true" />
            </button>
          )}
        </For>
      </nav>
      <div class="nb-page-editor" ref={mountElement} />
    </div>
  );
}
