/**
 * Inter as outlines, for drawing text without the browser's text rasteriser.
 *
 * The outlines come from the site's own self-hosted Inter, instanced at each
 * weight with kerning flattened into classes (see the extract script). Text is
 * set the way the site sets it: the kern feature on, tabular figures where a
 * column asks for them, no hinting. Characters the files do not cover (the
 * site's Inter is Latin and Latin Extended only) are reported, not drawn.
 * @module lib/shareImage/font
 */

import type { Segment } from './raster';

/** One weight of Inter: metrics, outlines by character, tabular digits, kerning classes. */
export interface FontData {
  readonly upm: number;
  readonly asc: number;
  readonly desc: number;
  readonly cap: number;
  readonly x: number;
  /** Character to [advance, outline]. */
  readonly g: Readonly<Record<string, readonly [number, string]>>;
  /** Digit to its tabular [advance, outline]. */
  readonly t: Readonly<Record<string, readonly [number, string]>>;
  readonly k: {
    readonly l: Readonly<Record<string, number>>;
    readonly r: Readonly<Record<string, number>>;
    readonly m: Readonly<Record<string, number>>;
  };
}

/** How a run of text is set. */
export interface TextStyle {
  readonly face: FontData;
  /** Font size in pixels. */
  readonly size: number;
  readonly tnum?: boolean;
  /** Letter spacing in ems. */
  readonly tracking?: number;
}

/** A glyph placed on the line, x in pixels from the run's start. */
export interface PlacedGlyph {
  readonly char: string;
  readonly x: number;
}

/** A shaped run: its glyphs, advance width and anything the font lacks. */
export interface Run {
  readonly glyphs: PlacedGlyph[];
  readonly width: number;
  readonly missing: string[];
}

function entry(face: FontData, char: string, tnum: boolean): readonly [number, string] | undefined {
  return (tnum ? face.t[char] : undefined) ?? face.g[char];
}

function kerning(face: FontData, left: string, right: string): number {
  const l = face.k.l[left];
  const r = face.k.r[right];
  return l === undefined || r === undefined ? 0 : (face.k.m[`${l},${r}`] ?? 0);
}

/** Set a line of text: advances, kerning and tracking, in pixels. */
export function shape(text: string, style: TextStyle): Run {
  const { face, size } = style;
  const scale = size / face.upm;
  const tracking = (style.tracking ?? 0) * size;
  const glyphs: PlacedGlyph[] = [];
  const missing: string[] = [];
  let pen = 0;
  let previous = '';
  for (const char of text.normalize('NFC')) {
    const found = entry(face, char, style.tnum === true);
    if (!found) {
      missing.push(char);
      continue;
    }
    if (previous) {
      pen += kerning(face, previous, char) * scale + tracking;
    }
    glyphs.push({ char, x: pen });
    pen += found[0] * scale;
    previous = char;
  }
  return { glyphs, width: pen, missing };
}

/** A run's advance width in pixels. */
export function measure(text: string, style: TextStyle): number {
  return shape(text, style).width;
}

const ELLIPSIS = '…';

/** The text, cut short with an ellipsis where it would run past `maxWidth`. */
export function fit(text: string, style: TextStyle, maxWidth: number): string {
  if (measure(text, style) <= maxWidth) {
    return text;
  }
  const chars = Array.from(text.normalize('NFC'));
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = chars.slice(0, mid).join('').trimEnd() + ELLIPSIS;
    if (measure(candidate, style) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return chars.slice(0, low).join('').trimEnd() + ELLIPSIS;
}

const parsed = new WeakMap<FontData, Map<string, Segment[]>>();

/** Parse a compact M/L/Q/Z outline in font units, y up. */
export function parseOutline(source: string): Segment[] {
  const out: Segment[] = [];
  for (const match of source.matchAll(/([MLQZ])([^MLQZ]*)/g)) {
    const n = match[2].trim() ? match[2].trim().split(/\s+/).map(Number) : [];
    if (match[1] === 'M') {
      out.push({ kind: 'move', x: n[0], y: n[1] });
    } else if (match[1] === 'L') {
      out.push({ kind: 'line', x: n[0], y: n[1] });
    } else if (match[1] === 'Q') {
      out.push({ kind: 'quad', cx: n[0], cy: n[1], x: n[2], y: n[3] });
    } else {
      out.push({ kind: 'close' });
    }
  }
  return out;
}

function outlineOf(face: FontData, char: string, tnum: boolean): Segment[] {
  let cache = parsed.get(face);
  if (!cache) {
    cache = new Map();
    parsed.set(face, cache);
  }
  const key = tnum && face.t[char] ? `t${char}` : char;
  let segments = cache.get(key);
  if (!segments) {
    segments = parseOutline(entry(face, char, tnum)?.[1] ?? '');
    cache.set(key, segments);
  }
  return segments;
}

function place(s: Segment, x: number, y: number, scale: number): Segment {
  switch (s.kind) {
    case 'move':
    case 'line':
      return { kind: s.kind, x: x + s.x * scale, y: y - s.y * scale };
    case 'quad':
      return { kind: 'quad', cx: x + s.cx * scale, cy: y - s.cy * scale, x: x + s.x * scale, y: y - s.y * scale };
    case 'cubic':
      return {
        kind: 'cubic',
        c1x: x + s.c1x * scale,
        c1y: y - s.c1y * scale,
        c2x: x + s.c2x * scale,
        c2y: y - s.c2y * scale,
        x: x + s.x * scale,
        y: y - s.y * scale
      };
    case 'close':
      return s;
    default:
      return s;
  }
}

/** A run as one path, its baseline starting at (x, y) in pixels, y down. */
export function textPath(run: Run, style: TextStyle, x: number, y: number): Segment[] {
  const scale = style.size / style.face.upm;
  const out: Segment[] = [];
  for (const glyph of run.glyphs) {
    for (const s of outlineOf(style.face, glyph.char, style.tnum === true)) {
      out.push(place(s, x + glyph.x, y, scale));
    }
  }
  return out;
}
