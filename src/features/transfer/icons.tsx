/**
 * src/features/transfer/icons.tsx — pre-wobbled vector icons for the transfer
 * panel. Every path is drawn slightly off-true (no runtime SVG filters, per
 * the art pipeline): arcs overshoot, corners miss, strokes are round-capped,
 * so the chrome reads as pencil rather than icon-font.
 */
import type { JSX } from 'solid-js';

interface IconProps {
  /** Stroke width; the rail uses 2.1, inline badges 1.8. */
  weight?: number;
}

function Frame(props: { children: JSX.Element }): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" class="nb-tr-icon" aria-hidden="true">
      {props.children}
    </svg>
  );
}

const stroke = (weight = 2.1): JSX.SvgSVGAttributes<SVGPathElement> => ({
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': String(weight),
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
});

/** A parcel with its lid lifting away — export. */
export function ExportIcon(props: IconProps): JSX.Element {
  return (
    <Frame>
      <path
        d="M 5.4 14.2 L 5.8 26.4 L 26.3 26.1 L 26.0 14.0"
        {...stroke(props.weight)}
      />
      <path d="M 4.2 13.9 L 27.4 13.6" {...stroke(props.weight)} />
      <path d="M 15.9 26.2 L 15.7 14.0" {...stroke((props.weight ?? 2.1) * 0.8)} />
      <path d="M 16.0 10.6 L 15.9 2.6" {...stroke(props.weight)} />
      <path d="M 12.1 6.2 L 16.0 2.4 L 20.1 6.4" {...stroke(props.weight)} />
    </Frame>
  );
}

/** The same parcel with an arrow dropping in — import. */
export function ImportIcon(props: IconProps): JSX.Element {
  return (
    <Frame>
      <path
        d="M 5.4 14.2 L 5.8 26.4 L 26.3 26.1 L 26.0 14.0"
        {...stroke(props.weight)}
      />
      <path d="M 4.2 13.9 L 27.4 13.6" {...stroke(props.weight)} />
      <path d="M 15.9 2.5 L 16.0 10.7" {...stroke(props.weight)} />
      <path d="M 12.0 7.0 L 16.0 10.9 L 20.2 6.8" {...stroke(props.weight)} />
    </Frame>
  );
}

/** A clock wound backwards — restore-point history. */
export function HistoryIcon(props: IconProps): JSX.Element {
  return (
    <Frame>
      <path
        d="M 8.2 8.9 A 10.4 10.2 0 1 1 6.4 19.6"
        {...stroke(props.weight)}
      />
      <path d="M 3.1 13.4 L 7.0 8.6 L 12.2 10.1" {...stroke(props.weight)} />
      <path d="M 16.2 10.4 L 16.4 16.5 L 21.0 18.4" {...stroke(props.weight)} />
    </Frame>
  );
}

/** A closed book, for tree rows. */
export function BookIcon(): JSX.Element {
  return (
    <Frame>
      <path
        d="M 7.4 5.1 L 7.1 26.6 L 24.9 26.9 L 25.2 5.4 Z"
        {...stroke(1.9)}
      />
      <path d="M 11.0 5.2 L 10.7 26.7" {...stroke(1.5)} />
      <path d="M 14.6 11.2 L 21.8 11.0 M 14.7 15.4 L 21.6 15.2" {...stroke(1.5)} />
    </Frame>
  );
}

/** A single sheet with a folded corner. */
export function PageIcon(): JSX.Element {
  return (
    <Frame>
      <path
        d="M 8.2 4.4 L 19.4 4.2 L 24.2 9.6 L 23.8 27.4 L 8.0 27.6 Z"
        {...stroke(1.9)}
      />
      <path d="M 19.2 4.4 L 19.5 9.8 L 24.1 9.6" {...stroke(1.6)} />
      <path
        d="M 11.6 14.4 L 20.4 14.2 M 11.7 18.6 L 20.2 18.4 M 11.8 22.6 L 17.4 22.4"
        {...stroke(1.5)}
      />
    </Frame>
  );
}

/** Hand-drawn tick for checked rows. */
export function TickIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" class="nb-tr-tick" aria-hidden="true">
      <path
        d="M 3.6 10.4 L 8.1 15.2 L 16.6 4.6"
        fill="none"
        stroke="currentColor"
        stroke-width="2.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Dash for the indeterminate (some pages ticked) state. */
export function DashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" class="nb-tr-tick" aria-hidden="true">
      <path
        d="M 4.4 10.2 L 15.8 9.8"
        fill="none"
        stroke="currentColor"
        stroke-width="2.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

/** Disclosure chevron (rotated by CSS when open). */
export function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" class="nb-tr-chevron" aria-hidden="true">
      <path
        d="M 7.6 4.4 L 13.4 10.1 L 7.4 15.7"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Small exclamation seal used on conflict badges. */
export function AlertIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" class="nb-tr-badge-icon" aria-hidden="true">
      <path
        d="M 10.1 2.6 A 7.6 7.4 0 1 1 9.7 2.6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
      />
      <path
        d="M 10.0 6.0 L 10.2 11.0 M 10.1 13.6 L 10.1 14.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
      />
    </svg>
  );
}

/**
 * A tied parcel with a twine bow — the watermark that fills the empty half
 * of the "in the parcel" card so it reads as a wrapped package, not a void.
 */
export function ParcelMark(): JSX.Element {
  return (
    <svg viewBox="0 0 120 92" class="nb-tr-parcel-svg" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M 13.4 33.6 L 14.8 84.2 L 105.6 83.1 L 104.2 32.8 Z" />
        <path d="M 9.6 33.2 L 108.9 31.9" />
        <path d="M 59.8 83.6 L 58.9 32.6" />
        <path d="M 55.2 32.4 C 47.6 25.4 40.1 21.8 34.4 22.6 C 27.9 23.4 26.6 30.1 33.1 31.9 C 38.6 33.4 47.2 33.1 55.6 32.5 Z" />
        <path d="M 63.1 32.3 C 70.9 25.6 78.6 22.2 84.2 23.2 C 90.6 24.2 91.6 30.9 85.1 32.5 C 79.5 33.8 71.4 33.2 63.4 32.4 Z" />
        <path d="M 24.9 47.4 L 40.2 46.9 M 25.4 57.1 L 34.8 56.8" />
      </g>
    </svg>
  );
}

/** Curling arrow — "revert this import". */
export function UndoIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" class="nb-tr-badge-icon" aria-hidden="true">
      <path
        d="M 4.6 9.4 L 14.6 9.2 A 5.4 5.2 0 1 1 14.2 19.6 L 9.4 19.7"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M 8.2 5.4 L 4.2 9.5 L 8.4 13.2"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
