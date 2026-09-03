/**
 * src/diagrams/render/TimelineDiagram.tsx — vertical spine timeline with
 * alternating hand-drawn cards, wobbled connectors and inked spine dots.
 */

import { createMemo, For, Show, type JSX } from 'solid-js';
import { fnv1a } from '../../art/noise';
import { wobbleRect } from '../../art/wobble';
import type { Attrs, TimelineEntry } from '../../script/types';
import {
  BODY_LINE_H,
  LABEL_LINE_H,
  PAD,
  layoutTimeline,
} from '../layout/timeline';
import type { LaidTimelineCard } from '../types';
import { washOf } from './NodeShape';
import { dotPath, edgeStrokes, nodeSeed, spineStrokes } from './svgParts';

// The card's interior geometry belongs to the layout — it is what sized the
// box these lines are being placed in. Re-declaring it here is how the text
// and the box it lives in drift apart (see the note beside the definitions).

/**
 * A timeline is a sequence of cards, so an undecorated entry should still
 * read as one member of that visual sequence rather than as an accidental
 * unpainted hole. Explicit author colours always win; omitted colours cycle
 * through a restrained six-wash palette.
 */
export const TIMELINE_DEFAULT_TINTS = [
  'amber',
  'sky',
  'lemon',
  'moss',
  'blush',
  'terracotta',
] as const;

export function timelineColorOf(
  attrs: Attrs | undefined,
  index: number,
): string {
  const explicit = washOf(attrs);
  if (explicit !== 'paper') return explicit;
  return TIMELINE_DEFAULT_TINTS[index % TIMELINE_DEFAULT_TINTS.length] ?? 'amber';
}

function TimelineCard(props: {
  card: LaidTimelineCard;
  spineX: number;
}): JSX.Element {
  const seed = createMemo(() =>
    nodeSeed('timeline', `${props.card.index}|${props.card.label}`),
  );
  const outline = createMemo(() =>
    wobbleRect(0, 0, props.card.width, props.card.height, {
      seed: seed(),
      amplitude: 1.1,
      frequency: 0.02,
    }),
  );
  const outline2 = createMemo(() =>
    wobbleRect(0, 0, props.card.width, props.card.height, {
      seed: (seed() ^ 0x9e3779b9) >>> 0,
      amplitude: 0.9,
      frequency: 0.026,
    }),
  );
  const color = createMemo(() =>
    timelineColorOf(props.card.attrs, props.card.index),
  );
  const connector = createMemo(() => {
    const edgeX =
      props.card.side === 'left' ? props.card.x + props.card.width : props.card.x;
    return edgeStrokes(
      [
        { x: edgeX, y: props.card.dotY },
        { x: props.spineX, y: props.card.dotY },
      ],
      (seed() ^ 0x51ed270b) >>> 0,
      2,
    );
  });

  return (
    <g class="nb-dg-tl-entry" data-wash={color()} data-color={color()}>
      <For each={connector().passes}>
        {(d) => <path class="nb-dg-edge-stroke" d={d} />}
      </For>
      <path
        class="nb-dg-dot"
        d={dotPath(props.spineX, props.card.dotY, 4.5, seed())}
      />
      <g transform={`translate(${props.card.x}, ${props.card.y})`}>
        <path
          class="nb-dg-shadow"
          d={outline()}
          transform="translate(2.5, 3.5)"
        />
        <path class="nb-dg-fill" d={outline()} />
        <path class="nb-dg-stroke" d={outline()} />
        <path class="nb-dg-stroke is-second" d={outline2()} />
        <Show when={props.card.label !== ''}>
          <text
            class="nb-dg-tl-label"
            x={PAD}
            y={PAD + LABEL_LINE_H / 2}
            dominant-baseline="central"
          >
            {props.card.label}
          </text>
        </Show>
        <For each={props.card.textLines}>
          {(line, i) => (
            <text
              class="nb-dg-tl-text"
              x={PAD}
              y={
                PAD +
                (props.card.label !== '' ? LABEL_LINE_H : 0) +
                i() * BODY_LINE_H +
                BODY_LINE_H / 2
              }
              dominant-baseline="central"
            >
              {line}
            </text>
          )}
        </For>
      </g>
    </g>
  );
}

export interface TimelineDiagramProps {
  entries: TimelineEntry[];
}

export function TimelineDiagram(props: TimelineDiagramProps): JSX.Element {
  const layout = createMemo(() => layoutTimeline(props.entries));
  const spine = createMemo(() =>
    spineStrokes(
      layout().spineX,
      6,
      layout().height - 6,
      fnv1a(`spine|${props.entries.length}`),
    ),
  );

  return (
    <svg
      class="nb-dg-svg"
      viewBox={`0 0 ${layout().width} ${layout().height}`}
      style={{ 'max-width': `${layout().width}px` }}
      role="img"
    >
      <path class="nb-dg-spine" d={spine()[0]} />
      <path class="nb-dg-spine is-second" d={spine()[1]} />
      <For each={layout().cards}>
        {(card) => <TimelineCard card={card} spineX={layout().spineX} />}
      </For>
    </svg>
  );
}
