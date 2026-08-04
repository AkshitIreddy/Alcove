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

/**
 * A tied parcel — the row that leads on to the parcel desk (bundles in,
 * bundles out, and the undo book).
 *
 * Its own drawing rather than `features/transfer/icons.tsx`'s: those carry
 * `.nb-tr-icon` and are sized by transfer.css, which the book rail does not
 * load, so a borrowed glyph would come out at whatever the SVG default is.
 */
export function ParcelIcon(): JSX.Element {
  return frame(
    <>
      <path
        d="M 4.3 7.6 C 9.4 6.7 14.6 6.7 19.7 7.5 C 20.1 12.1 20.1 16.4 19.6 20.6 C 14.5 21.4 9.4 21.4 4.4 20.5 C 3.9 16.3 3.9 11.9 4.3 7.6 Z"
        {...S}
      />
      <path d="M 12 7.1 C 12.1 11.8 12.1 16.4 12 20.9" {...S} stroke-width="1.4" />
      <path d="M 4.4 13.6 C 9.5 13 14.6 13 19.7 13.5" {...S} stroke-width="1.4" />
      <path
        d="M 12 7.2 C 10.6 5.6 9.3 4.4 8.2 3.6 C 7.2 2.9 6.2 3.5 6.4 4.6 C 6.7 5.9 8.4 6.8 11.9 7.2 C 15.4 6.8 17.2 5.8 17.5 4.5 C 17.7 3.4 16.7 2.9 15.7 3.6 C 14.6 4.4 13.3 5.6 12 7.2 Z"
        {...S}
        stroke-width="1.4"
      />
    </>,
  );
}

/**
 * An out-tray with something rising out of it — the rail button that opens
 * "Take it out", where the PDF, the picture, the script and the Markdown
 * import live together.
 *
 * Deliberately NOT another page-with-an-arrow: `ExportScriptIcon` in
 * `views/rail/icons.tsx` is already that, and the two sit four buttons apart
 * on the same rail.
 */
export function OutTrayIcon(): JSX.Element {
  return frame(
    <>
      <path
        d="M 4.4 13.3 C 4.6 16.1 4.7 18.3 4.9 19.9 C 9.6 20.6 14.4 20.6 19.2 19.9 C 19.4 18.3 19.5 16.1 19.6 13.2"
        {...S}
      />
      <path
        d="M 4.4 13.3 C 6.3 13.1 8 13.1 9.4 13.2 C 9.9 14.6 10.8 15.3 12 15.3 C 13.2 15.3 14.1 14.6 14.6 13.2 C 16 13.1 17.7 13.1 19.6 13.2"
        {...S}
        stroke-width="1.5"
      />
      <path
        d="M 12 3.1 C 12 5.5 12 7.9 11.9 10.3 M 9.5 5.6 C 10.3 4.7 11.2 3.9 12 3.1 C 12.9 3.9 13.7 4.7 14.5 5.5"
        {...S}
        stroke-width="1.6"
      />
    </>,
  );
}

/**
 * A stack of ready-written cards with a spark over the corner — the templates
 * gallery.
 *
 * The first cut put a five-pointed star INSIDE the front card. At 24px the
 * star was 7px across and its inner points closed up into a blob, so the icon
 * read as "a card with something on it". The spark sits outside the card now
 * (the same four-point mark `StickerIcon` already uses, so the rail keeps one
 * vocabulary) and the card carries plain ruled lines, which is what a template
 * actually is: a page somebody has already written on.
 */
export function TemplatesIcon(): JSX.Element {
  return frame(
    <>
      <path
        d="M 8.4 5.4 C 11.1 5.1 13.8 5.1 16.4 5.4 M 6.9 8.3 C 10.1 7.9 13.3 7.9 17 8.2"
        {...S}
        stroke-width="1.4"
        opacity="0.55"
      />
      <path
        d="M 4.6 11.1 C 9.6 10.6 14.6 10.6 19.6 11.1 C 20 14.9 20 18.1 19.5 21.2 C 14.6 21.8 9.6 21.8 4.9 21.1 C 4.4 17.9 4.3 14.6 4.6 11.1 Z"
        {...S}
      />
      <path
        d="M 7.6 14.6 C 10.5 14.3 13.4 14.3 16.4 14.6 M 7.7 17.8 C 10.1 17.5 12.5 17.5 14.3 17.7"
        {...S}
        stroke-width="1.3"
        opacity="0.6"
      />
      <path
        d="M 20.2 2.2 C 20.6 3.8 21.3 4.5 22.9 4.9 C 21.3 5.3 20.6 6 20.2 7.6 C 19.8 6 19.1 5.3 17.5 4.9 C 19.1 4.5 19.8 3.8 20.2 2.2 Z"
        {...S}
        stroke-width="1.3"
      />
    </>,
  );
}
