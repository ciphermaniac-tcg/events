/**
 * One player's event as a share image, the "head bar" layout: the site's
 * near-black bar carries the event, its date and the site's address; under it
 * the player's sprites and name, place and deck, the four figures as one line,
 * then every round between hairlines under a quiet column head. A pure
 * function of the player's data and a measure, so it is tested without pixels.
 * @module lib/shareImage/headBar
 */

import { t } from '../i18n';
import type { Rgb } from './raster';
import type { Measure, Op, RectOp, Scene, TextOp } from './scene';

export interface ShareDeck {
  readonly label: string;
  /** Sprite slugs, the first two drawn. */
  readonly sprites: readonly string[];
}

export type ShareMark = 'W' | 'L' | 'T';

export interface ShareRound {
  /** What the round column says: the round's number, or a top cut stage ("Top 8", "Final"). */
  readonly label: string;
  /** A top cut stage, set a size down so it fits the column. */
  readonly cut: boolean;
  readonly opponent: { readonly name: string; readonly record: string; readonly deck: ShareDeck | null } | null;
  /** What the row says without an opponent: "Bye" or "Missed round". */
  readonly note: string;
  readonly mark: ShareMark;
  /** The mark as the page's language writes it. */
  readonly letter: string;
}

/** Everything the image says, formatted before it gets here. A deck is null wherever the public page hides it. */
export interface PlayerShare {
  readonly event: string;
  readonly date: string;
  readonly name: string;
  /** "2nd in Masters" */
  readonly place: string;
  readonly deck: ShareDeck | null;
  readonly record: string;
  readonly points: string;
  readonly owp: string;
  readonly oowp: string;
  readonly rounds: readonly ShareRound[];
}

export type ShareTheme = 'light' | 'dark';

interface Palette {
  readonly bg: Rgb;
  readonly surface: Rgb;
  readonly surface2: Rgb;
  readonly fg: Rgb;
  readonly muted: Rgb;
  readonly rule: Rgb;
  readonly accent: Rgb;
  readonly accentFill: Rgb;
  readonly accentFg: Rgb;
  readonly head: Rgb;
  readonly headFg: Rgb;
  readonly headMuted: Rgb;
}

const LIGHT: Palette = {
  bg: [0xec, 0xec, 0xea],
  surface: [0xff, 0xff, 0xff],
  surface2: [0xe3, 0xe4, 0xe1],
  fg: [0x20, 0x22, 0x1f],
  muted: [0x50, 0x54, 0x4f],
  rule: [0xbf, 0xc3, 0xbc],
  accent: [0xbb, 0x77, 0x00],
  accentFill: [0xee, 0xaa, 0x11],
  accentFg: [0x20, 0x22, 0x1f],
  head: [0x1c, 0x1d, 0x1b],
  headFg: [0xf5, 0xf3, 0xeb],
  headMuted: [0xb9, 0xb6, 0xaa]
};

const DARK: Palette = {
  bg: [0x16, 0x16, 0x15],
  surface: [0x25, 0x25, 0x23],
  surface2: [0x33, 0x33, 0x2f],
  fg: [0xf5, 0xf3, 0xeb],
  muted: [0xb9, 0xb6, 0xaa],
  rule: [0x59, 0x59, 0x4f],
  accent: [0xee, 0xaa, 0x11],
  accentFill: [0xee, 0xaa, 0x11],
  accentFg: [0x20, 0x22, 0x1f],
  head: [0x23, 0x24, 0x22],
  headFg: [0xf5, 0xf3, 0xeb],
  headMuted: [0xb9, 0xb6, 0xaa]
};

const SITE = 'events.ciphermaniac.com';
const WIDTH = 440;
const PAD = 20;
const INNER = WIDTH - 2 * PAD;
const BAR = 62;
const ROW = 40;
const BOX = 22;
const BADGE = 22;
/** The round column's right edge, and where the opponent column starts, from the rows' left. */
const NUM_RIGHT = 36;
const OPP_X = 50;
/** How far a second sprite overlaps the first, as on the site. */
const OVERLAP = 0.3;
/** Inter's cap height in ems, for centring a line on its capitals. */
const CAP = 0.7275;

type Style = Pick<TextOp, 'size' | 'weight' | 'color'> &
  Partial<Pick<TextOp, 'tnum' | 'tracking' | 'align' | 'maxWidth'>>;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What every piece draws with. */
interface Pen {
  readonly ops: Op[];
  readonly measure: Measure;
  readonly pal: Palette;
  /** The width the rows keep for sprites. */
  readonly slot: number;
}

const text = (x: number, y: number, words: string, style: Style): TextOp => ({
  kind: 'text',
  x,
  y,
  text: words,
  ...style
});

const rect = (box: Box, color: Rgb, r = 0): RectOp => ({ kind: 'rect', ...box, color, r });

/** The baseline that centres a line's capitals in a band. */
const middle = (top: number, h: number, size: number) => top + (h + CAP * size) / 2;

const deckWidth = (count: number, box: number) =>
  count > 0 ? box + (Math.min(2, count) - 1) * box * (1 - OVERLAP) : 0;

/** Up to two sprites, the second overlapping the first; returns the width taken. */
function sprites(pen: Pen, deck: ShareDeck | null, [x, y]: readonly [number, number], box: number): number {
  if (!deck) {
    return 0;
  }
  // One scale for every sprite in a row: a sprite pixel is half a point below a 40-point box, as the page draws them.
  const scale = box >= 40 ? 2 : 1;
  deck.sprites.slice(0, 2).forEach((slug, i) => {
    pen.ops.push({ kind: 'sprite', x: x + i * box * (1 - OVERLAP), y, size: box, slug, scale });
  });
  return deckWidth(deck.sprites.length, box);
}

/** The page's result square: a win filled marigold, a tie filled grey, a loss outlined. */
function badge(pen: Pen, row: ShareRound, x: number, y: number): void {
  const { pal } = pen;
  const r = Math.min(6, BADGE / 3);
  const win = row.mark === 'W';
  const edge = win ? pal.accent : pal.muted;
  const fill = win ? pal.accentFill : row.mark === 'T' ? pal.surface2 : pal.surface;
  pen.ops.push(rect({ x, y, w: BADGE, h: BADGE }, edge, r));
  pen.ops.push(rect({ x: x + 1, y: y + 1, w: BADGE - 2, h: BADGE - 2 }, fill, r - 1));
  const size = Math.round(BADGE * 0.55);
  pen.ops.push(
    text(x + BADGE / 2, middle(y, BADGE, size), row.letter, {
      size,
      weight: 700,
      color: win ? pal.accentFg : pal.fg,
      align: 'center'
    })
  );
}

function bar(pen: Pen, share: PlayerShare): void {
  const { pal } = pen;
  pen.ops.push(rect({ x: 0, y: 0, w: WIDTH, h: BAR }, pal.head));
  pen.ops.push(text(PAD, 27, share.event, { size: 15, weight: 600, color: pal.headFg, maxWidth: INNER }));
  pen.ops.push(text(PAD, 47, share.date, { size: 12, weight: 400, color: pal.headMuted }));
  pen.ops.push(text(WIDTH - PAD, 47, SITE, { size: 11, weight: 600, color: pal.headMuted, align: 'right' }));
}

/** Sprites and name, place and deck; returns the y under them. */
function player(pen: Pen, share: PlayerShare, top: number): number {
  const { pal } = pen;
  const box = 30;
  const used = sprites(pen, share.deck, [PAD, top], box);
  const x = PAD + (used ? used + 8 : 0);
  pen.ops.push(
    text(x, middle(top, box, 22), share.name, {
      size: 22,
      weight: 700,
      color: pal.fg,
      maxWidth: PAD + INNER - x,
      tracking: -0.01
    })
  );
  const y = top + box + 6;
  const sub = share.deck ? `${share.place} · ${share.deck.label}` : share.place;
  pen.ops.push(text(PAD, y + 13, sub, { size: 14, weight: 400, color: pal.muted, maxWidth: INNER }));
  return y + 32;
}

/** The four figures as one line, labels over values; returns the y under them. */
function figures(pen: Pen, share: PlayerShare, top: number): number {
  const { pal, measure } = pen;
  const stats: [string, string][] = [
    [t('Record'), share.record],
    [t('Points'), share.points],
    ['OWP', share.owp],
    ['OOWP', share.oowp]
  ];
  let x = PAD;
  for (const [label, value] of stats) {
    pen.ops.push(text(x, top + 11, label, { size: 12, weight: 500, color: pal.muted }));
    pen.ops.push(text(x, top + 33, value, { size: 17, weight: 700, color: pal.fg, tnum: true }));
    x += Math.max(measure(label, 12, 500), measure(value, 17, 700, true)) + 26;
  }
  return top + 50;
}

/** The hairline and the column head over the rounds; returns the y under them. */
function columnHead(pen: Pen, top: number): number {
  const { pal } = pen;
  pen.ops.push(rect({ x: PAD, y: top, w: INNER, h: 1 }, pal.rule));
  const y = top + 21;
  const style: Style = { size: 11, weight: 600, color: pal.muted };
  pen.ops.push(text(PAD + NUM_RIGHT, y, t('Round'), { ...style, align: 'right' }));
  pen.ops.push(text(PAD + OPP_X, y, t('Opponent'), style));
  pen.ops.push(text(PAD + INNER, y, t('Result'), { ...style, align: 'right' }));
  return top + 30;
}

/** The opponent's record, right-aligned before the result; returns its width. */
function record(pen: Pen, row: ShareRound, right: number, top: number): number {
  const words = row.opponent?.record ?? '';
  if (!words) {
    return 0;
  }
  pen.ops.push(
    text(right, middle(top, ROW, 13), words, {
      size: 13,
      weight: 400,
      color: pen.pal.muted,
      align: 'right',
      tnum: true
    })
  );
  return pen.measure(words, 13, 400, true);
}

function round(pen: Pen, row: ShareRound, index: number, top: number): void {
  const { pal } = pen;
  if (index > 0) {
    pen.ops.push(rect({ x: PAD, y: top, w: INNER, h: 1 }, pal.rule));
  }
  const numSize = row.cut ? 12 : 14;
  pen.ops.push(
    text(PAD + NUM_RIGHT, middle(top, ROW, numSize), row.label, {
      size: numSize,
      weight: 400,
      color: pal.muted,
      align: 'right',
      tnum: true
    })
  );
  const left = PAD + OPP_X;
  sprites(pen, row.opponent?.deck ?? null, [left, top + (ROW - BOX) / 2], BOX);
  const badgeX = PAD + INNER - BADGE;
  badge(pen, row, badgeX, top + (ROW - BADGE) / 2);
  const recordRight = badgeX - 16;
  const recordWidth = record(pen, row, recordRight, top);
  const x = left + (row.opponent ? pen.slot : 0);
  pen.ops.push(
    text(x, middle(top, ROW, 14), row.opponent?.name ?? row.note, {
      size: 14,
      weight: row.opponent ? 600 : 400,
      color: row.opponent ? pal.fg : pal.muted,
      maxWidth: recordRight - recordWidth - 12 - x
    })
  );
}

/** The head bar share image of one player's event. */
export function headBarScene(share: PlayerShare, measure: Measure, theme: ShareTheme): Scene {
  const pal = theme === 'dark' ? DARK : LIGHT;
  // Room for two sprites on every row whenever any opponent's deck shows, so the names line up.
  const slot = share.rounds.some(row => row.opponent?.deck) ? deckWidth(2, BOX) + 8 : 0;
  const pen: Pen = { ops: [], measure, pal, slot };
  bar(pen, share);
  let y = player(pen, share, BAR + 20);
  y = columnHead(pen, figures(pen, share, y));
  share.rounds.forEach((row, i) => round(pen, row, i, y + i * ROW));
  const height = y + share.rounds.length * ROW + 18;
  return { width: WIDTH, height, background: theme === 'dark' ? pal.bg : pal.surface, ops: pen.ops };
}
