/**
 * src/features/templates/templates.ts — the built-in template library
 * (roadmap item 26). Every template is authored as Notebook Script so the
 * gallery preview, the inserted pages and "Export Script" all agree; they
 * parse warning-free (asserted in tests/export.test.ts).
 */

export interface NotebookTemplate {
  id: string;
  name: string;
  blurb: string;
  script: string;
}

const CORNELL = `---
title: Cornell notes
paper: lined
ink: sepia
---

# Topic — date {underline=marker}

::: banner {color=sky}
**Cue → Notes → Summary.** Fill the right column in class, the left after.
:::

::: columns {gap=lg}
::: col {width=1}
## Cues {color=sky}
- key question?
- key term
- memory hook
:::
::: col {width=2}
## Notes {color=moss}
- main idea in your own words
- supporting detail
- example from class
:::
:::

::: sticky-note {color=lemon, rotate=-1, tape=corner}
**Summary** — two or three lines, written from memory.
:::
`;

const LECTURE = `---
title: Lecture notes
paper: grid
ink: sepia
---

# Lecture — course · date {sticker=book}

::: callout {variant=info}
Before class: skim last week's summary. After: write the recap below.
:::

## Big ideas {underline=squiggle}

- first big idea
- second big idea

## Details & examples

1. walk through the example
2. note the tricky step

> One quote or definition worth keeping, word for word. {washi=top}

## Recap {color=amber}

::: card {shadow=soft}
Three sentences, from memory, no peeking.
:::

- [ ] review these notes within 24 hours
- [ ] add one practice question
`;

const FLASHCARDS = `---
title: Flashcards
paper: dotted
ink: graphite
---

# Flashcard deck {sticker=sparkle}

::: callout {variant=tip}
Read the question, answer out loud, then tap to reveal. Shuffle often.
:::

::: card
**Q1.** Write the first question here?
:::
::: spoiler
**A1.** The answer hides here until clicked.
:::

::: card
**Q2.** Second question — keep them small?
:::
::: spoiler
**A2.** One idea per card beats five.
:::

::: card
**Q3.** What happens to cards you miss?
:::
::: spoiler
**A3.** They go to tomorrow's pile — mark them with a sticker.
:::
`;

const PLANNER = `---
title: Weekly planner
paper: lined
ink: ink-blue
---

# Week of … {sticker=sun}

::: banner {color=amber}
**Top three this week** — if only these happen, the week was good.
:::

- [ ] first priority
- [ ] second priority
- [ ] third priority

## Monday {color=sky}
- [ ] …

## Tuesday {color=moss}
- [ ] …

## Wednesday {color=amber}
- [ ] …

## Thursday {color=blush}
- [ ] …

## Friday {color=terracotta}
- [ ] …

## Weekend {color=lemon}
- [ ] one small adventure

::: sticky-note {color=blush, rotate=2}
Friday check-in: what moved? what rolls over?
:::
`;

const READING_LOG = `---
title: Reading log
paper: cream
ink: sepia
---

# Reading log {sticker=leaf}

| Book | Author | Started | Finished | ★ |
| ---- | ------ | ------- | -------- | --- |
| … | … | … | … | ★★★☆☆ |
| … | … | … | … | … |

## Currently reading

::: polaroid {rotate=-2}
Paste the cover here — or a photo of your reading spot.
:::

::: quote-card {color=amber}
A line worth keeping, copied by hand.
:::

## Notes & wonderings

- what surprised me
- what I want to read next
`;

export const NOTEBOOK_TEMPLATES: readonly NotebookTemplate[] = [
  {
    id: 'cornell',
    name: 'Cornell notes',
    blurb: 'cue column, notes column, summary strip',
    script: CORNELL,
  },
  {
    id: 'lecture',
    name: 'Lecture notes',
    blurb: 'big ideas, details, 24-hour recap',
    script: LECTURE,
  },
  {
    id: 'flashcards',
    name: 'Flashcard deck',
    blurb: 'question cards with tap-to-reveal answers',
    script: FLASHCARDS,
  },
  {
    id: 'planner',
    name: 'Weekly planner',
    blurb: 'top three + a lane for every day',
    script: PLANNER,
  },
  {
    id: 'reading-log',
    name: 'Reading log',
    blurb: 'book table, current read, kept quotes',
    script: READING_LOG,
  },
];
