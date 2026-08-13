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

/**
 * A friendly toy robot face — the in-book AI agent.
 *
 * Lucide's Bot and Google's Smart Toy were used only to confirm the tiny-icon
 * vocabulary (antenna, boxy head, paired eyes). This is an original Alcove
 * drawing: the shell bows, the ears do not match exactly, and its shy smile is
 * laid in with the same current-colour ink as every rail icon. No stock path,
 * runtime filter, texture, lighting or second outline is involved.
 *
 * References: https://lucide.dev/icons/bot
 *             https://fonts.google.com/icons?selected=Material+Symbols+Outlined:smart_toy
 */
export function AgentIcon(): JSX.Element {
  return frame(
    <>
      <path
        data-part="head"
        d="M 5.3 7.5 C 9.6 6.8 14.3 6.8 18.7 7.5 C 19.2 10.9 19.2 14.7 18.7 18.2 C 14.5 18.9 9.7 18.9 5.4 18.2 C 4.8 14.8 4.8 11 5.3 7.5 Z"
        {...S}
        fill="currentColor"
        fill-opacity="0.08"
      />
      <path
        data-part="antenna"
        d="M 12 6.8 C 12.1 5.8 12 4.9 11.9 4 M 10.7 3.2 C 11.3 2.6 12.3 2.5 13 3.1 C 12.8 4 12.2 4.4 11.4 4.2 C 10.9 4 10.7 3.7 10.7 3.2 Z"
        {...S}
        stroke-width="1.5"
        fill="currentColor"
        fill-opacity="0.16"
      />
      <path
        data-part="ears"
        d="M 5 10.2 C 3.8 9.9 3.1 10.4 3 11.5 L 3.1 14.2 C 3.3 15.1 3.9 15.5 5 15.2 M 19 10.2 C 20.2 9.9 20.9 10.4 21 11.4 L 20.9 14.1 C 20.7 15.1 20.1 15.5 19 15.2"
        {...S}
        stroke-width="1.55"
      />
      <path
        data-part="eyes"
        d="M 8.2 11.1 C 8.9 10.8 9.6 11 9.9 11.6 C 10 12.4 9.6 13 8.9 13.1 C 8.2 13.1 7.8 12.6 7.8 12 C 7.8 11.6 7.9 11.3 8.2 11.1 Z M 14.7 11.1 C 15.4 10.9 16.1 11.1 16.3 11.7 C 16.4 12.4 16 13 15.3 13.1 C 14.6 13.1 14.2 12.6 14.2 12 C 14.2 11.6 14.4 11.3 14.7 11.1 Z"
        {...S}
        stroke-width="1.2"
        fill="currentColor"
      />
      <path
        data-part="smile"
        d="M 9.5 15.5 C 10.9 16.2 12.5 16.3 14.2 15.5"
        {...S}
        stroke-width="1.45"
      />
    </>,
  );
}

/** The AI guide arriving as a file — download the Notebook Script spec. */
export function DownloadSpecIcon(): JSX.Element {
  return frame(
    <>
      <path
        d="M 5.7 3.9 C 9.4 3.6 13 3.7 16.8 4 C 17.1 8.6 17.1 13.3 16.8 18 C 13.1 18.3 9.5 18.3 5.9 17.9 C 5.5 13.2 5.5 8.5 5.7 3.9 Z"
        {...S}
      />
      <path
        d="M 8 7.5 C 9.7 7.3 11.3 7.3 12.7 7.5 M 8 10.5 C 9.3 10.3 10.6 10.3 11.8 10.5"
        {...S}
        stroke-width="1.3"
        opacity="0.55"
      />
      <path
        d="M 17.9 8.1 C 18 10.8 18 13.4 17.9 16.1 M 15.7 14 C 16.5 14.9 17.2 15.8 17.9 16.7 C 18.7 15.8 19.4 14.9 20.1 14"
        {...S}
        stroke-width="1.6"
      />
      <path
        d="M 14.6 19.9 C 16.8 20.2 18.9 20.2 21 19.9"
        {...S}
        stroke-width="1.4"
      />
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

/** Indented list lines — table of contents. */
export function TocIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 5.2 5.6 C 10 5.2 14.8 5.2 19.4 5.7" {...S} stroke-width="2" />
      <path d="M 8.3 10.3 C 12 10 15.7 10 19.2 10.3 M 8.4 14.7 C 11.9 14.4 15.4 14.4 18.9 14.7" {...S} stroke-width="1.5" />
      <path d="M 5.3 18.9 C 9.9 18.5 14.5 18.5 19.1 19" {...S} stroke-width="2" />
      <path d="M 5.5 10.4 C 5.9 10.3 6.2 10.3 6.5 10.4 M 5.6 14.8 C 6 14.7 6.3 14.7 6.6 14.8" {...S} stroke-width="1.8" opacity="0.6" />
    </>,
  );
}

/** Hourglass with swirl — page history "time-turner". */
export function HistoryIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 12.1 12 C 8.9 10.2 7.4 8 7.2 4.6 C 10.4 4.2 13.7 4.2 16.9 4.7 C 16.7 8 15.2 10.2 12.1 12 Z" {...S} />
      <path d="M 12.1 12 C 15.2 13.8 16.7 16 16.9 19.4 C 13.7 19.8 10.4 19.8 7.2 19.3 C 7.4 16 8.9 13.8 12.1 12 Z" {...S} />
      <path d="M 10 17.6 C 11.4 16.9 12.8 16.9 14.2 17.7" {...S} stroke-width="1.4" opacity="0.6" />
      <path d="M 19.9 8.3 C 21 9.6 21.3 11.2 20.8 12.9" {...S} stroke-width="1.3" opacity="0.55" />
    </>,
  );
}

/** Corner brackets around a dot — focus mode. */
export function FocusIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 4.6 8.2 C 4.4 6.9 4.5 5.8 4.9 4.8 C 5.9 4.4 7 4.3 8.3 4.5 M 15.8 4.5 C 17.1 4.3 18.2 4.4 19.2 4.8 C 19.6 5.9 19.7 7 19.5 8.3 M 19.5 15.8 C 19.7 17.1 19.6 18.2 19.2 19.2 C 18.1 19.6 17 19.7 15.7 19.5 M 8.2 19.5 C 6.9 19.7 5.8 19.6 4.8 19.2 C 4.4 18.1 4.3 17 4.5 15.7" {...S} />
      <path d="M 12 10.2 C 13 10.5 13.6 11.1 13.8 12.1 C 13.5 13 12.9 13.6 11.9 13.8 C 11 13.5 10.4 12.9 10.2 11.9 C 10.5 11 11.1 10.4 12 10.2 Z" {...S} stroke-width="1.6" />
    </>,
  );
}

/** Small hand-drawn gear — Settings from the focus-only rail. */
export function SettingsIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 18.8 12.2 C 18.8 15.9 15.9 18.8 12.1 18.8 C 8.3 18.8 5.3 15.9 5.4 12.1 C 5.4 8.4 8.4 5.4 12.2 5.4 C 15.9 5.4 18.8 8.4 18.8 12.2 Z" {...S} />
      <path d="M 14.6 12.1 C 14.6 13.5 13.5 14.6 12.1 14.6 C 10.7 14.6 9.6 13.5 9.6 12.1 C 9.6 10.7 10.7 9.6 12.1 9.6 C 13.5 9.6 14.6 10.7 14.6 12.1 Z M 12.2 5.3 L 12.2 2.9 M 12 21.1 L 12 18.8 M 5.4 12.2 L 3 12.2 M 21 12 L 18.7 12 M 7.3 7.3 L 5.6 5.6 M 18.5 18.5 L 16.8 16.8 M 16.9 7.2 L 18.6 5.5 M 5.6 18.6 L 7.3 16.9" {...S} stroke-width="1.6" />
    </>,
  );
}

/** Bookmark ribbon with a forked tail. */
export function RibbonIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 8.1 4.2 C 10.7 3.9 13.3 3.9 15.9 4.3 C 16.2 9.4 16.2 14.5 15.8 19.8 C 14.5 18.5 13.2 17.3 12 16.1 C 10.8 17.2 9.6 18.4 8.3 19.6 C 7.9 14.4 7.8 9.3 8.1 4.2 Z" {...S} />
      <path d="M 10.3 7.6 C 11.4 7.5 12.6 7.5 13.7 7.6" {...S} stroke-width="1.3" opacity="0.55" />
    </>,
  );
}

/** Row of tiny frames — thumbnails filmstrip. */
export function FilmstripIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 3.6 9.1 C 9.2 8.7 14.9 8.7 20.5 9.2 C 20.7 11.1 20.7 13 20.4 14.9 C 14.8 15.3 9.2 15.3 3.7 14.8 C 3.4 12.9 3.4 11 3.6 9.1 Z" {...S} />
      <path d="M 9.2 9 C 9 11 9 13 9.2 15 M 14.9 9 C 14.7 11 14.7 13 14.9 15" {...S} stroke-width="1.4" />
      <path d="M 5.4 5.9 C 9.8 5.6 14.2 5.6 18.6 5.9 M 5.5 18.1 C 9.9 18.4 14.3 18.4 18.7 18.1" {...S} stroke-width="1.2" opacity="0.5" />
    </>,
  );
}

/** Little pencil — autosave scribble indicator (rail footer). */
export function PencilIcon(): JSX.Element {
  return frame(
    <>
      <path d="M 16.9 3.8 C 17.9 4.4 18.8 5.2 19.5 6.2 C 15.9 10.4 12.3 14.2 8.6 17.8 C 7.4 18.1 6.2 18.3 4.9 18.4 C 5.1 17.1 5.3 15.9 5.7 14.7 C 9.3 11 12.9 7.4 16.9 3.8 Z" {...S} />
      <path d="M 15.1 5.9 C 16 6.5 16.8 7.2 17.5 8.1" {...S} stroke-width="1.3" opacity="0.6" />
      <path d="M 10.5 20.5 C 13.6 20.1 16.8 20.1 19.9 20.4" {...S} stroke-width="1.3" opacity="0.45" />
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
