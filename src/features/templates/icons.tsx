/**
 * src/features/templates/icons.tsx — hand-drawn rail icons for group D's
 * tools, drawn to the same conventions as src/views/rail/icons.tsx (24×24
 * viewBox, pre-wobbled paths, currentColor strokes, .nb-rail-icon class) so
 * the rail wiring can drop them straight into the TOOLS table.
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

/** Little book with a down arrow — export the book as PDF. */
export function ExportPdfIcon(): JSX.Element {
  return frame(
    <>
      <path
        d="M 5.6 4.8 C 8 3.9 10.3 3.9 11.9 5.1 C 13.6 3.9 15.9 3.8 18.4 4.7 C 18.7 8.4 18.7 12 18.3 15.6 C 16 14.9 13.9 15 12 16.1 C 10.1 15 8 14.9 5.8 15.7 C 5.4 12.1 5.3 8.4 5.6 4.8 Z"
        {...S}
      />
      <path d="M 11.9 5.4 C 12 8.6 12 11.8 12 15.6" {...S} stroke-width="1.3" opacity="0.6" />
      <path
        d="M 12 17.6 C 12 18.7 12 19.8 12 20.9 M 9.7 19 C 10.4 19.9 11.2 20.7 12 21.4 C 12.8 20.6 13.6 19.8 14.2 19"
        {...S}
        stroke-width="1.6"
      />
    </>,
  );
}

/** Page with a mountain photo + down arrow — export page as PNG. */
export function ExportPngIcon(): JSX.Element {
  return frame(
    <>
      <path
        d="M 6.2 3.9 C 10 3.6 13.7 3.6 17.6 4 C 17.9 7.5 17.9 10.9 17.7 14.4 C 13.9 14.7 10.2 14.7 6.4 14.3 C 6.1 10.8 6 7.3 6.2 3.9 Z"
        {...S}
      />
      <path
        d="M 7.9 12.3 C 9.3 10.5 10.6 8.9 11.7 7.7 C 12.9 9 14.2 10.6 15.9 12.5 M 14.2 6.9 C 14.7 6.8 15.2 7.1 15.3 7.6 C 15.3 8.1 14.9 8.5 14.4 8.5 C 13.9 8.4 13.6 8 13.7 7.5"
        {...S}
        stroke-width="1.4"
      />
      <path
        d="M 12 16.4 C 12 17.7 12 18.9 11.9 20.6 M 9.6 18.6 C 10.4 19.5 11.2 20.3 12 21.1 C 12.8 20.2 13.5 19.4 14.3 18.6"
        {...S}
        stroke-width="1.6"
      />
    </>,
  );
}

/** Arrow dropping into an open book — import Markdown. */
export function ImportMdIcon(): JSX.Element {
  return frame(
    <>
      <path
        d="M 4.6 10.2 C 7 9.4 9.4 9.4 11.9 10.7 C 14.4 9.4 16.9 9.3 19.5 10.1 C 19.7 13.3 19.7 16.4 19.4 19.5 C 16.9 18.8 14.4 18.9 12 20 C 9.6 18.9 7.2 18.8 4.8 19.4 C 4.4 16.3 4.4 13.2 4.6 10.2 Z"
        {...S}
      />
      <path d="M 11.9 10.9 C 12 13.7 12 16.5 12 19.4" {...S} stroke-width="1.3" opacity="0.6" />
      <path
        d="M 12 2.9 C 12 4.3 12 5.6 12 7 M 9.8 5.2 C 10.5 6 11.2 6.8 12 7.6 C 12.8 6.8 13.5 6 14.2 5.2"
        {...S}
        stroke-width="1.6"
      />
    </>,
  );
}

/** Stack of cards with a star — templates gallery. */
export function TemplatesIcon(): JSX.Element {
  return frame(
    <>
      <path
        d="M 7.5 6.5 C 10.9 6.1 14.2 6.1 17.6 6.4 M 6.3 9.4 C 10.1 9 13.9 9 17.9 9.3"
        {...S}
        stroke-width="1.4"
        opacity="0.6"
      />
      <path
        d="M 5.3 11.9 C 9.7 11.5 14.1 11.5 18.7 11.9 C 19 14.9 19 17.6 18.6 20.3 C 14.3 20.7 10 20.7 5.6 20.2 C 5.2 17.4 5.1 14.6 5.3 11.9 Z"
        {...S}
      />
      <path
        d="M 12 13.7 C 12.3 14.6 12.6 15.3 13 15.9 C 13.7 16 14.4 16.2 15.1 16.4 C 14.6 16.9 14.1 17.4 13.6 17.9 C 13.7 18.6 13.8 19.3 13.8 20 C 13.2 19.6 12.6 19.3 12 19 C 11.4 19.3 10.8 19.7 10.2 20 C 10.3 19.3 10.4 18.6 10.5 17.9 C 10 17.4 9.5 16.9 9 16.4 C 9.7 16.2 10.4 16 11 15.9 C 11.3 15.2 11.7 14.5 12 13.7 Z"
        {...S}
        stroke-width="1.3"
      />
    </>,
  );
}
