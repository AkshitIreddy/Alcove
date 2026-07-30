/**
 * src/views/rail/icons.tsx — hand-drawn icon set for the book's left rail.
 *
 * Pre-wobbled static SVG paths (art-pipeline doc: icons are pre-distorted
 * vector, never runtime-filtered). All stroke `currentColor` so the rail CSS
 * owns the ink. 24×24 viewBox, drawn with slightly drunken C-curves.
 */
import type { JSX } from 'solid-js';

function frame(children: JSX.Element): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" class="nb-rail-icon" aria-hidden="true">
      {children}
    </svg>
  );
}

const S = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.8,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

/** Paintbrush — customize the book. */
export function BrushIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 19.2 3.4 C 17.1 5.1 14.6 7.5 12.4 10.1 C 13.2 10.7 13.9 11.5 14.4 12.3 C 16.9 10 19.3 7.4 20.9 5.3 C 21.6 4.3 20.2 2.8 19.2 3.4 Z" {...S} />
      <path d="M 11.5 11.2 C 9.9 11.5 8.9 12.6 8.6 14.1 C 8.3 15.7 7.5 16.9 6.1 17.6 C 8 18.9 10.7 18.8 12.3 17.3 C 13.5 16.2 13.9 14.3 13.3 12.9" {...S} />
      <path d="M 4.2 20.6 C 6.8 20.9 9.4 20.8 12.1 20.5" {...S} stroke-width="1.4" opacity="0.55" />
    </>,
  );
}

/** Ruled sheet — page style. */
export function PageStyleIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 6.1 3.6 C 10 3.3 13.9 3.4 17.8 3.7 C 18 8.9 18.1 14.4 17.7 20.3 C 13.9 20.6 10.1 20.5 6.3 20.2 C 5.9 14.6 5.9 9 6.1 3.6 Z" {...S} />
      <path d="M 8.4 8.2 C 10.8 8 13.2 8 15.6 8.2 M 8.3 11.6 C 10.8 11.4 13.3 11.4 15.7 11.6 M 8.4 15 C 10.7 14.8 13.1 14.8 15.5 15" {...S} stroke-width="1.4" />
    </>,
  );
}

/** Star + sparkle — stickers & effects. */
export function StickerIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 11.9 4.2 C 12.7 6.1 13.4 7.8 14.2 9.2 C 15.8 9.4 17.4 9.7 19 10.2 C 17.8 11.5 16.6 12.7 15.5 13.8 C 15.8 15.5 16 17.2 16.1 18.9 C 14.6 18.1 13.2 17.3 11.9 16.6 C 10.5 17.4 9.1 18.1 7.7 18.8 C 7.9 17.1 8.1 15.5 8.4 13.9 C 7.2 12.7 6.1 11.5 5 10.1 C 6.6 9.7 8.2 9.4 9.7 9.2 C 10.4 7.6 11.1 5.9 11.9 4.2 Z" {...S} />
      <path d="M 19.6 3.4 C 19.8 4.6 20.4 5.2 21.5 5.4 C 20.4 5.7 19.8 6.3 19.5 7.4 C 19.3 6.3 18.7 5.7 17.7 5.4 C 18.7 5.1 19.3 4.5 19.6 3.4 Z" {...S} stroke-width="1.2" />
    </>,
  );
}

/** Arrow flowing INTO braces — insert script. */
export function InsertScriptIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 8.2 4.3 C 6.6 4.6 6 5.5 6.1 7.1 C 6.2 8.6 5.8 10.4 4.1 11.9 C 5.8 13.3 6.3 15.1 6.1 16.7 C 5.9 18.4 6.6 19.4 8.3 19.7" {...S} />
      <path d="M 15.8 4.3 C 17.4 4.6 18 5.5 17.9 7.1 C 17.8 8.6 18.2 10.4 19.9 11.9 C 18.2 13.3 17.7 15.1 17.9 16.7 C 18.1 18.4 17.4 19.4 15.7 19.7" {...S} />
      <path d="M 9.2 12 C 11 11.8 12.8 11.9 14.8 12 M 12.5 9.4 C 13.5 10.3 14.4 11.2 15.1 12 C 14.3 12.8 13.4 13.7 12.4 14.6" {...S} stroke-width="1.5" />
    </>,
  );
}

/** Arrow flying OUT of a page — export script. */
export function ExportScriptIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 14.6 4.4 C 11.9 4.2 9.3 4.3 6.6 4.6 C 6.3 9.6 6.3 14.7 6.7 19.9 C 10.2 20.2 13.6 20.2 17.2 19.8 C 17.4 17.4 17.5 15.1 17.5 12.8" {...S} />
      <path d="M 11.2 12.6 C 13.6 10.2 16 7.9 18.6 5.6 M 14.7 5.1 C 16.2 5.1 17.6 5.2 19 5.4 C 19.2 6.8 19.3 8.2 19.3 9.7" {...S} stroke-width="1.5" />
    </>,
  );
}

/** Spark in a speech bubble — copy the AI spec. */
export function AiSpecIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 5.2 5.4 C 9.7 4.7 14.3 4.7 18.9 5.5 C 19.5 8.3 19.5 11 18.8 13.7 C 15.9 14.3 13 14.5 10.1 14.3 C 9 15.6 7.7 16.8 6.2 17.8 C 6.4 16.5 6.5 15.3 6.5 14.1 C 5.9 14 5.4 13.8 4.9 13.6 C 4.3 10.8 4.4 8.1 5.2 5.4 Z" {...S} />
      <path d="M 11.9 6.9 C 12.3 8.3 13.1 9.1 14.5 9.4 C 13.1 9.8 12.3 10.6 11.9 12 C 11.5 10.6 10.7 9.8 9.4 9.4 C 10.7 9.1 11.5 8.3 11.9 6.9 Z" {...S} stroke-width="1.4" />
      <path d="M 8.9 19.9 C 11.1 20.3 13.3 20.4 15.5 20.2" {...S} stroke-width="1.3" opacity="0.5" />
    </>,
  );
}

/** Plus over a page corner — add a page. */
export function AddPageIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 12.2 5.2 C 11.9 9.6 12 14 11.8 18.6 M 5.4 12.1 C 9.8 11.6 14.3 11.7 18.8 11.9" {...S} stroke-width="2.2" />
    </>,
  );
}

/** Hand-drawn close cross (panels). */
export function CloseIcon(): JSX.Element {
  return frame(
    <path
      d="M 5.4 6.1 C 9.6 10.2 13.9 14.1 18.4 18.2 M 18.1 5.6 C 14.3 10 10 14 5.8 18.4"
      {...S}
      stroke-width="2"
    />,
  );
}
