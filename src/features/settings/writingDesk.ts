import type { WritingDeskId } from '../../data/types';

export type WritingDeskFamily =
  | 'paper'
  | 'rose'
  | 'warm'
  | 'garden'
  | 'water'
  | 'evening';
export type WritingDeskTone = 'light' | 'dark';

export interface WritingDeskSpec {
  readonly id: WritingDeskId;
  readonly label: string;
  readonly line: string;
  readonly color: string;
  readonly family: WritingDeskFamily;
  /** Chrome drawn directly on the field needs a pale ink on the deep desks. */
  readonly tone: WritingDeskTone;
}

/**
 * Flat colours for the field around an open notebook.
 *
 * These are pigments, not themes: changing one never touches the page, the
 * binding, or any pagination measurement. The single solid face is also the
 * reason this lives outside the room-theme vocabulary.
 */
export const WRITING_DESKS: readonly WritingDeskSpec[] = [
  // A writing desk is a supporting field, not a poster. These pigments stay
  // unmistakably coloured while holding enough light that the cream paper is
  // always the visual focus. Grey-browns still do not crowd out the choices.
  { id: 'linen', label: 'linen', line: 'Warm and nearly white.', color: '#f4eee4', family: 'paper', tone: 'light' },
  { id: 'buttercup', label: 'buttercup', line: 'A soft, sunny yellow.', color: '#f6e6a6', family: 'paper', tone: 'light' },
  { id: 'blush', label: 'blush', line: 'A gentle petal-pink.', color: '#f4cedd', family: 'rose', tone: 'light' },
  { id: 'mint', label: 'mint', line: 'A fresh pale spring green.', color: '#c4e7d8', family: 'garden', tone: 'light' },
  { id: 'sky', label: 'sky', line: 'A clear, airy blue.', color: '#c4e2ef', family: 'water', tone: 'light' },
  { id: 'clay', label: 'clay', line: 'A quiet warm terracotta.', color: '#f1c5b6', family: 'warm', tone: 'light' },
  { id: 'plum', label: 'plum', line: 'A pale violet-plum field.', color: '#d7c5e5', family: 'evening', tone: 'light' },
  { id: 'cobalt', label: 'cobalt', line: 'A softened painterly blue.', color: '#c1cbea', family: 'water', tone: 'light' },

  // Seventeen authored companions. Their hue is visible at a glance, while
  // their value stays calm enough for long writing sessions.
  { id: 'marigold', label: 'marigold', line: 'A mellow orange-gold.', color: '#f3d28e', family: 'paper', tone: 'light' },
  { id: 'honey', label: 'honey', line: 'A soft yellow wash.', color: '#efdda4', family: 'warm', tone: 'light' },
  { id: 'apricot', label: 'apricot', line: 'A pale, warm orange.', color: '#f4d0b6', family: 'warm', tone: 'light' },
  { id: 'rosewood', label: 'rosewood', line: 'A quiet antique rose.', color: '#e1bdc3', family: 'rose', tone: 'light' },
  { id: 'coral', label: 'coral', line: 'A soft pink-coral field.', color: '#f5c1b8', family: 'rose', tone: 'light' },
  { id: 'raspberry', label: 'raspberry', line: 'A clear berry-pink tint.', color: '#e8b5c8', family: 'rose', tone: 'light' },
  { id: 'seafoam', label: 'seafoam', line: 'A pale coastal green.', color: '#bfe6d8', family: 'garden', tone: 'light' },
  { id: 'fern', label: 'fern', line: 'A soft leafy green.', color: '#c1dfba', family: 'garden', tone: 'light' },
  { id: 'peony', label: 'peony', line: 'A floral pink with a violet note.', color: '#edc7e0', family: 'rose', tone: 'light' },
  { id: 'emerald', label: 'emerald', line: 'A pale jewel-green field.', color: '#b6ddc6', family: 'garden', tone: 'light' },
  { id: 'periwinkle', label: 'periwinkle', line: 'A soft blue-violet.', color: '#cbd2ee', family: 'water', tone: 'light' },
  { id: 'rose', label: 'rose', line: 'A clear, light notebook pink.', color: '#efbfd0', family: 'rose', tone: 'light' },
  { id: 'teal', label: 'teal', line: 'A pale blue-green field.', color: '#b6dddd', family: 'water', tone: 'light' },
  { id: 'lavender', label: 'lavender', line: 'A soft violet field.', color: '#dccbea', family: 'evening', tone: 'light' },
  { id: 'mulberry', label: 'mulberry', line: 'A quiet wine-pink field.', color: '#dab8cc', family: 'rose', tone: 'light' },
  { id: 'cranberry', label: 'cranberry', line: 'A softened red-pink.', color: '#deb0bb', family: 'rose', tone: 'light' },
  { id: 'midnight', label: 'midnight', line: 'A misty indigo field.', color: '#bec7e3', family: 'evening', tone: 'light' },
];

/**
 * The eight desks met first. This is a curation, not the first eight written:
 * it deliberately mixes old anchors with the clearest new pigments so the
 * closed picker already spans rose, warm, botanical and cool desks.
 */
const WRITING_DESK_SHORTLIST_IDS: readonly WritingDeskId[] = [
  'linen',
  'blush',
  'coral',
  'rose',
  'mint',
  'sky',
  'buttercup',
  'teal',
];
export const WRITING_DESK_SHORTLIST = WRITING_DESK_SHORTLIST_IDS.map(
  (id) => WRITING_DESKS.find((desk) => desk.id === id)!,
);
export const WRITING_DESK_FAMILIES: readonly WritingDeskFamily[] = [
  'paper',
  'rose',
  'warm',
  'garden',
  'water',
  'evening',
];

export const WRITING_DESK_FAMILY_LABELS: Readonly<Record<WritingDeskFamily, string>> = {
  paper: 'sunshine and paper',
  rose: 'roses and reds',
  warm: 'sun-warmed pigments',
  garden: 'garden greens',
  water: 'sky and water',
  evening: 'evening desks',
};

export const WRITING_DESK_FAMILY_BLURBS: Readonly<Record<WritingDeskFamily, string>> = {
  paper: 'linen, buttercup and marigold',
  rose: 'petal pink through rose, raspberry and cranberry',
  warm: 'clay, fruit, timber and late-afternoon gold',
  garden: 'mint, leaf and jewel greens',
  water: 'clear blues, periwinkle and teal',
  evening: 'misty violets and indigo',
};

export const WRITING_DESK_IDS = WRITING_DESKS.map((desk) => desk.id);
export const DEFAULT_WRITING_DESK_ID: WritingDeskId = 'linen';

const BY_ID = new Map(WRITING_DESKS.map((desk) => [desk.id, desk] as const));

export function writingDesk(id: WritingDeskId): WritingDeskSpec {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_WRITING_DESK_ID)!;
}

export function writingDeskColor(id: WritingDeskId): string {
  return writingDesk(id).color;
}

export function writingDeskTone(id: WritingDeskId): WritingDeskTone {
  return writingDesk(id).tone;
}
