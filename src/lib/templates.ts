import type { BoardTemplateId, ColumnAccent } from './board-types';

export interface TemplateColumnDef {
  title: string;
  accent: ColumnAccent;
  isActionColumn?: boolean;
}

export interface BoardTemplate {
  id: BoardTemplateId;
  name: string;
  description: string;
  columns: readonly TemplateColumnDef[];
}

export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  {
    id: 'standard',
    name: 'Standard Retro',
    description: 'Classic sprint review with dedicated Action Items tracking.',
    columns: [
      { title: 'Went Well', accent: 'sage' },
      { title: 'To Improve', accent: 'rose' },
      { title: 'Action Items', accent: 'sky', isActionColumn: true },
    ],
  },
  {
    id: 'start-stop-continue',
    name: 'Start / Stop / Continue',
    description: 'Action-focused format to adjust team habits quickly.',
    columns: [
      { title: 'Start Doing', accent: 'sage' },
      { title: 'Stop Doing', accent: 'rose' },
      { title: 'Continue Doing', accent: 'sky' },
    ],
  },
  {
    id: 'mad-sad-glad',
    name: 'Mad / Sad / Glad',
    description: 'Check in on team sentiment and emotional highlights.',
    columns: [
      { title: 'Mad', accent: 'coral' },
      { title: 'Sad', accent: 'sky' },
      { title: 'Glad', accent: 'sage' },
    ],
  },
  {
    id: '4ls',
    name: '4Ls',
    description: 'Reflect across Liked, Learned, Lacked, and Longed For.',
    columns: [
      { title: 'Liked', accent: 'sage' },
      { title: 'Learned', accent: 'sky' },
      { title: 'Lacked', accent: 'amber' },
      { title: 'Longed For', accent: 'violet' },
    ],
  },
  {
    id: 'starfish',
    name: 'Starfish',
    description: 'Fine-grained tuning of practices to dial up or down.',
    columns: [
      { title: 'Keep Doing', accent: 'sage' },
      { title: 'Less Of', accent: 'amber' },
      { title: 'More Of', accent: 'teal' },
      { title: 'Stop Doing', accent: 'rose' },
      { title: 'Start Doing', accent: 'sky' },
    ],
  },
  {
    id: 'sailboat',
    name: 'Sailboat',
    description: 'Visualize tailwinds, anchors, risks, and destination goals.',
    columns: [
      { title: 'Wind (Helps Us)', accent: 'sky' },
      { title: 'Anchor (Holds Us Back)', accent: 'slate' },
      { title: 'Rocks (Risks)', accent: 'coral' },
      { title: 'Island (Goals)', accent: 'sage' },
    ],
  },
  {
    id: 'six-thinking-hats',
    name: 'Six Thinking Hats',
    description: 'Explore a topic from six distinct analytical perspectives.',
    columns: [
      { title: 'Facts (White)', accent: 'slate' },
      { title: 'Feelings (Red)', accent: 'rose' },
      { title: 'Caution (Black)', accent: 'violet' },
      { title: 'Benefits (Yellow)', accent: 'amber' },
      { title: 'Creativity (Green)', accent: 'sage' },
      { title: 'Process (Blue)', accent: 'sky' },
    ],
  },
  {
    id: 'pros-cons',
    name: 'Pros & Cons',
    description: 'Weigh trade-offs cleanly for fast group decisions.',
    columns: [
      { title: 'Pros', accent: 'sage' },
      { title: 'Cons', accent: 'coral' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom Board',
    description: 'Build your own layout with 1 to 10 customizable Columns.',
    columns: [
      { title: 'Column 1', accent: 'slate' },
      { title: 'Column 2', accent: 'sage' },
      { title: 'Column 3', accent: 'sky' },
    ],
  },
] as const;

export function getBoardTemplate(id: BoardTemplateId): BoardTemplate {
  const found = BOARD_TEMPLATES.find((template) => template.id === id);
  return found ?? BOARD_TEMPLATES[0];
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Formats the default Board title: `"Sprint Retrospective — <MMM D>"`.
 * Uses UTC month/day so SSR and client formatting stay deterministic.
 */
export function formatDefaultBoardTitle(date: Date = new Date()): string {
  const month = SHORT_MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  return `Sprint Retrospective — ${month} ${day}`;
}

export interface ColumnAccentClasses {
  label: string;
  bar: string;
  tint: string;
  swatch: string;
}

/**
 * Static Tailwind v4 class mapping for the 8 curated pastel Column accents
 * (guarantees Tailwind scans every token without dynamic class interpolation).
 */
export const COLUMN_ACCENT_STYLES: Record<ColumnAccent, ColumnAccentClasses> = {
  slate: {
    label: 'Slate',
    bar: 'bg-col-slate',
    tint: 'bg-col-slate-tint',
    swatch: 'bg-col-slate',
  },
  sage: {
    label: 'Sage',
    bar: 'bg-col-sage',
    tint: 'bg-col-sage-tint',
    swatch: 'bg-col-sage',
  },
  sky: {
    label: 'Sky',
    bar: 'bg-col-sky',
    tint: 'bg-col-sky-tint',
    swatch: 'bg-col-sky',
  },
  amber: {
    label: 'Amber',
    bar: 'bg-col-amber',
    tint: 'bg-col-amber-tint',
    swatch: 'bg-col-amber',
  },
  rose: {
    label: 'Rose',
    bar: 'bg-col-rose',
    tint: 'bg-col-rose-tint',
    swatch: 'bg-col-rose',
  },
  violet: {
    label: 'Violet',
    bar: 'bg-col-violet',
    tint: 'bg-col-violet-tint',
    swatch: 'bg-col-violet',
  },
  teal: {
    label: 'Teal',
    bar: 'bg-col-teal',
    tint: 'bg-col-teal-tint',
    swatch: 'bg-col-teal',
  },
  coral: {
    label: 'Coral',
    bar: 'bg-col-coral',
    tint: 'bg-col-coral-tint',
    swatch: 'bg-col-coral',
  },
};
