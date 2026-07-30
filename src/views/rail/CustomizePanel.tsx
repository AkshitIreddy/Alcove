/**
 * src/views/rail/CustomizePanel.tsx — per-book customization sheet.
 *
 * Two halves:
 *  1. Cover editor — live canvas preview + palette / texture / frame /
 *     medallion / title-font / gilt controls. Every change flows up through
 *     onOverridesChange; BookView persists to cover_meta (src/data/books)
 *     and the backdrop + pull-out cover re-bake reactively.
 *  2. Page defaults — line spacing (26–40px), page style and ink applied to
 *     the book's current AND future pages (BookView owns the application).
 */
import { For, createEffect, type JSX } from 'solid-js';
import {
  COVER_FRAME_COUNT,
  COVER_MEDALLION_COUNT,
  COVER_PALETTE_COUNT,
  coverPaletteCss,
  deriveCoverParams,
  normalizeCoverOverrides,
  renderCoverInto,
  type CoverOverrides,
} from '../../art/covers';
import type { BookPageDefaults } from '../../data/books';
import type { PageStyle } from '../../data/types';

const TEXTURES = ['cloth', 'leather', 'paper'] as const;
const FRAMES = ['rules', 'corners', 'scallop', 'stitch'] as const;
const MEDALLIONS = [
  'diamond',
  'laurel',
  'star',
  'flower',
  'chevron',
  'sun',
  'moon',
  'keyhole',
] as const;
const TITLE_FONTS = ['Caveat', 'Kalam', 'Patrick Hand'] as const;
const PAGE_STYLES: readonly PageStyle[] = ['ruled', 'grid', 'blank', 'dotted'];
const INKS = [
  { value: 'sepia', label: 'sepia' },
  { value: 'graphite', label: 'graphite' },
  { value: 'ink-blue', label: 'ink blue' },
] as const;

export const LINE_SPACING_MIN = 26;
export const LINE_SPACING_MAX = 40;
const DEFAULT_LINE_SPACING = 32;

export interface CustomizePanelProps {
  spineSeed: number;
  title: string;
  overrides: CoverOverrides | null;
  onOverridesChange(next: CoverOverrides | null): void;
  pageDefaults: BookPageDefaults | null;
  onPageDefaultsChange(next: BookPageDefaults | null): void;
}

export default function CustomizePanel(props: CustomizePanelProps): JSX.Element {
  let previewCanvas: HTMLCanvasElement | undefined;

  const params = (): ReturnType<typeof deriveCoverParams> =>
    deriveCoverParams(
      props.spineSeed,
      normalizeCoverOverrides(props.overrides as unknown),
    );

  // Live preview — re-painted on every override change.
  createEffect(() => {
    const p = params();
    const canvas = previewCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderCoverInto(ctx, canvas.width, canvas.height, p, props.title);
  });

  const patch = (partial: CoverOverrides): void => {
    const next = { ...(props.overrides ?? {}), ...partial };
    props.onOverridesChange(Object.keys(next).length > 0 ? next : null);
  };

  const patchDefaults = (partial: BookPageDefaults): void => {
    props.onPageDefaultsChange({ ...(props.pageDefaults ?? {}), ...partial });
  };

  const lineSpacing = (): number =>
    props.pageDefaults?.lineHeightPx ?? DEFAULT_LINE_SPACING;

  return (
    <div class="nb-customize">
      <div class="nb-cover-preview-wrap">
        <canvas
          ref={(el) => (previewCanvas = el)}
          width={228}
          height={310}
          class="nb-cover-preview"
          aria-label="Cover preview"
        />
      </div>

      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">cover colors</h3>
        <div class="nb-swatch-grid" role="group" aria-label="Cover palette">
          <For each={Array.from({ length: COVER_PALETTE_COUNT }, (_, i) => i)}>
            {(i) => {
              const duo = coverPaletteCss(i);
              return (
                <button
                  type="button"
                  class="nb-swatch"
                  style={{
                    background: `linear-gradient(160deg, ${duo.top}, ${duo.bottom})`,
                  }}
                  aria-label={`Palette ${i + 1}`}
                  aria-pressed={params().palette === i}
                  classList={{ 'is-active': params().palette === i }}
                  onClick={() => patch({ palette: i })}
                />
              );
            }}
          </For>
        </div>
      </section>

      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">binding</h3>
        <div class="nb-chip-row" role="group" aria-label="Cover texture">
          <For each={TEXTURES}>
            {(name, i) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={params().texture === i()}
                onClick={() => patch({ texture: i() as 0 | 1 | 2 })}
              >
                {name}
              </button>
            )}
          </For>
        </div>
        <div class="nb-chip-row" role="group" aria-label="Frame style">
          <For each={FRAMES.slice(0, COVER_FRAME_COUNT)}>
            {(name, i) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={params().frame === i()}
                onClick={() => patch({ frame: i() })}
              >
                {name}
              </button>
            )}
          </For>
        </div>
      </section>

      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">medallion</h3>
        <div class="nb-chip-grid" role="group" aria-label="Center medallion">
          <For each={MEDALLIONS.slice(0, COVER_MEDALLION_COUNT)}>
            {(name, i) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={params().medallion === i()}
                onClick={() => patch({ medallion: i() })}
              >
                {name}
              </button>
            )}
          </For>
        </div>
      </section>

      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">title & gilt</h3>
        <div class="nb-chip-row" role="group" aria-label="Title lettering">
          <For each={TITLE_FONTS}>
            {(name, i) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={params().titleFont === i()}
                onClick={() => patch({ titleFont: i() as 0 | 1 | 2 })}
              >
                {name}
              </button>
            )}
          </For>
        </div>
        <div class="nb-chip-row">
          <button
            type="button"
            class="nb-chip nb-chip-gilt"
            role="switch"
            aria-checked={params().gilt}
            aria-pressed={params().gilt}
            onClick={() => patch({ gilt: !params().gilt })}
          >
            gold tooling
          </button>
          <button
            type="button"
            class="nb-chip nb-chip-ghost"
            onClick={() => props.onOverridesChange(null)}
          >
            reset cover
          </button>
        </div>
      </section>

      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">pages of this book</h3>
        <label class="nb-panel-row">
          <span class="nb-panel-row-label">
            line spacing <em class="nb-panel-row-hint">{lineSpacing()}px</em>
          </span>
          <input
            type="range"
            class="nb-panel-slider"
            min={LINE_SPACING_MIN}
            max={LINE_SPACING_MAX}
            step={1}
            value={lineSpacing()}
            aria-label="Line spacing"
            onInput={(e) =>
              patchDefaults({ lineHeightPx: Number(e.currentTarget.value) })
            }
          />
        </label>
        <div class="nb-chip-row" role="group" aria-label="Default page style">
          <For each={PAGE_STYLES}>
            {(style) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={props.pageDefaults?.pageStyle === style}
                onClick={() => patchDefaults({ pageStyle: style })}
              >
                {style}
              </button>
            )}
          </For>
        </div>
        <div class="nb-chip-row" role="group" aria-label="Ink color">
          <For each={INKS}>
            {(ink) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={props.pageDefaults?.ink === ink.value}
                onClick={() => patchDefaults({ ink: ink.value })}
              >
                {ink.label}
              </button>
            )}
          </For>
        </div>
        <p class="nb-panel-footnote">
          applies to every page of this book, now and later
        </p>
      </section>
    </div>
  );
}
