/**
 * A software rasteriser for share images, so the same picture comes out of
 * every browser to the pixel.
 *
 * A canvas draws text and curves with the engine's own rasteriser (Skia,
 * Core Graphics, Cairo), each antialiasing its own way, and Firefox and Safari
 * add noise to canvas readback under fingerprinting protection. Here shapes are
 * flattened to lines and their coverage accumulated as signed area (the
 * font-rs method), using only arithmetic that IEEE 754 fixes exactly, so every
 * engine computes the same bytes.
 * @module lib/shareImage/raster
 */

/** An opaque sRGB colour, 0 to 255 a channel. */
export type Rgb = readonly [number, number, number];

/** A drawing surface: opaque RGB, three bytes a pixel, rows top to bottom. */
export interface Surface {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** A point in surface pixels. */
export type Point = readonly [number, number];

/** A box in surface pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A closed outline as a flat list of points, x then y, in surface pixels. */
export type Polygon = number[];

/** A path segment: a line or a quadratic or cubic curve to its last point. */
export type Segment =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly x: number; readonly y: number }
  | { readonly kind: 'quad'; readonly cx: number; readonly cy: number; readonly x: number; readonly y: number }
  | {
      readonly kind: 'cubic';
      readonly c1x: number;
      readonly c1y: number;
      readonly c2x: number;
      readonly c2y: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: 'close' };

/** A surface filled with one colour. */
export function createSurface(width: number, height: number, fill: Rgb): Surface {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = fill[0];
    pixels[i + 1] = fill[1];
    pixels[i + 2] = fill[2];
  }
  return { width, height, pixels };
}

/** Pieces a curve is cut into: enough that no chord strays a visible fraction of a pixel. */
function steps(span: number): number {
  return Math.min(32, Math.max(1, Math.ceil(span / 3)));
}

function quadPoints(out: Polygon, x0: number, y0: number, s: Extract<Segment, { kind: 'quad' }>): void {
  const n = steps(Math.abs(s.cx - x0) + Math.abs(s.cy - y0) + Math.abs(s.x - s.cx) + Math.abs(s.y - s.cy));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(u * u * x0 + 2 * u * t * s.cx + t * t * s.x, u * u * y0 + 2 * u * t * s.cy + t * t * s.y);
  }
}

function cubicPoints(out: Polygon, x0: number, y0: number, s: Extract<Segment, { kind: 'cubic' }>): void {
  const span =
    Math.abs(s.c1x - x0) +
    Math.abs(s.c1y - y0) +
    Math.abs(s.c2x - s.c1x) +
    Math.abs(s.c2y - s.c1y) +
    Math.abs(s.x - s.c2x) +
    Math.abs(s.y - s.c2y);
  const n = steps(span);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push(a * x0 + b * s.c1x + c * s.c2x + d * s.x, a * y0 + b * s.c1y + c * s.c2y + d * s.y);
  }
}

/** Flatten a path into closed polygons of straight edges. */
export function flatten(path: readonly Segment[]): Polygon[] {
  const polygons: Polygon[] = [];
  let current: Polygon = [];
  const finish = () => {
    if (current.length >= 6) {
      polygons.push(current);
    }
    current = [];
  };
  for (const s of path) {
    if (s.kind === 'close' || s.kind === 'move') {
      finish();
      if (s.kind === 'move') {
        current.push(s.x, s.y);
      }
      continue;
    }
    const x0 = current[current.length - 2] ?? 0;
    const y0 = current[current.length - 1] ?? 0;
    if (s.kind === 'line') {
      current.push(s.x, s.y);
    } else if (s.kind === 'quad') {
      quadPoints(current, x0, y0, s);
    } else {
      cubicPoints(current, x0, y0, s);
    }
  }
  finish();
  return polygons;
}

/** Coverage accumulated over a box of the surface, one cell a pixel plus a spare column. */
interface Accumulator {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly cells: Float64Array;
}

function bounds(polygons: readonly Polygon[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i += 2) {
      minX = Math.min(minX, poly[i]);
      maxX = Math.max(maxX, poly[i]);
      minY = Math.min(minY, poly[i + 1]);
      maxY = Math.max(maxY, poly[i + 1]);
    }
  }
  return [minX, minY, maxX, maxY];
}

function accumulator(polygons: readonly Polygon[]): Accumulator | null {
  const [minX, minY, maxX, maxY] = bounds(polygons);
  if (!(maxX > minX && maxY > minY)) {
    return null;
  }
  const left = Math.floor(minX);
  const top = Math.floor(minY);
  const width = Math.ceil(maxX) - left + 2;
  const height = Math.ceil(maxY) - top;
  return { left, top, width, height, cells: new Float64Array(width * height) };
}

/** Spread one row's share of an edge over the cells it crosses (font-rs). */
function spanRow(acc: Accumulator, row: number, [xa, xb]: readonly [number, number], d: number): void {
  const { cells } = acc;
  const start = row * acc.width;
  const x0 = Math.min(xa, xb);
  const x1 = Math.max(xa, xb);
  const x0floor = Math.floor(x0);
  const x1ceil = Math.ceil(x1);
  if (x1ceil <= x0floor + 1) {
    const mid = 0.5 * (xa + xb) - x0floor;
    cells[start + x0floor] += d - d * mid;
    cells[start + x0floor + 1] += d * mid;
    return;
  }
  const s = 1 / (x1 - x0);
  const x0f = x0 - x0floor;
  const a0 = 0.5 * s * (1 - x0f) * (1 - x0f);
  const x1f = x1 - x1ceil + 1;
  const am = 0.5 * s * x1f * x1f;
  cells[start + x0floor] += d * a0;
  if (x1ceil === x0floor + 2) {
    cells[start + x0floor + 1] += d * (1 - a0 - am);
  } else {
    const a1 = s * (1.5 - x0f);
    cells[start + x0floor + 1] += d * (a1 - a0);
    for (let x = x0floor + 2; x < x1ceil - 1; x++) {
      cells[start + x] += d * s;
    }
    const a2 = a1 + (x1ceil - x0floor - 3) * s;
    cells[start + x1ceil - 1] += d * (1 - a2 - am);
  }
  cells[start + x1ceil] += d * am;
}

function edge(acc: Accumulator, [ax, ay]: Point, [bx, by]: Point): void {
  if (ay === by) {
    return;
  }
  const dir = ay < by ? 1 : -1;
  const [x0, y0, x1, y1] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay];
  const dxdy = (x1 - x0) / (y1 - y0);
  let x = x0;
  for (let row = Math.floor(y0); row < Math.ceil(y1); row++) {
    const dy = Math.min(row + 1, y1) - Math.max(row, y0);
    const next = x + dxdy * dy;
    spanRow(acc, row, [x, next], dy * dir);
    x = next;
  }
}

/** Blend a colour into the surface by each covered pixel's share. */
function composite(surface: Surface, acc: Accumulator, color: Rgb, alpha: number): void {
  for (let row = 0; row < acc.height; row++) {
    const y = acc.top + row;
    let sum = 0;
    for (let col = 0; col < acc.width; col++) {
      sum += acc.cells[row * acc.width + col];
      const x = acc.left + col;
      const cover = Math.min(1, Math.abs(sum)) * alpha;
      if (cover > 0 && x >= 0 && y >= 0 && x < surface.width && y < surface.height) {
        blend(surface, (y * surface.width + x) * 3, color, cover);
      }
    }
  }
}

/** Mix a colour over one pixel; rounding is explicit, so every engine lands on the same byte. */
export function blend(surface: Surface, at: number, color: Rgb, cover: number): void {
  const p = surface.pixels;
  p[at] = Math.round(p[at] + (color[0] - p[at]) * cover);
  p[at + 1] = Math.round(p[at + 1] + (color[1] - p[at + 1]) * cover);
  p[at + 2] = Math.round(p[at + 2] + (color[2] - p[at + 2]) * cover);
}

/** Fill a path, nonzero for same-direction overlaps, antialiased. */
export function fillPath(surface: Surface, path: readonly Segment[], color: Rgb, alpha = 1): void {
  const polygons = flatten(path);
  const acc = accumulator(polygons);
  if (!acc) {
    return;
  }
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i += 2) {
      const j = (i + 2) % poly.length;
      edge(acc, [poly[i] - acc.left, poly[i + 1] - acc.top], [poly[j] - acc.left, poly[j + 1] - acc.top]);
    }
  }
  composite(surface, acc, color, alpha);
}

/** Bezier handle length for a quarter circle. */
const KAPPA = 0.5522847498;

/** A rectangle with rounded corners as a path, clockwise. */
export function roundedRect({ x, y, w, h }: Box, r: number): Segment[] {
  const k = Math.min(r, w / 2, h / 2);
  const c = k * (1 - KAPPA);
  const right = x + w;
  const bottom = y + h;
  if (k <= 0) {
    return [
      { kind: 'move', x, y },
      { kind: 'line', x: right, y },
      { kind: 'line', x: right, y: bottom },
      { kind: 'line', x, y: bottom },
      { kind: 'close' }
    ];
  }
  return [
    { kind: 'move', x: x + k, y },
    { kind: 'line', x: right - k, y },
    { kind: 'cubic', c1x: right - c, c1y: y, c2x: right, c2y: y + c, x: right, y: y + k },
    { kind: 'line', x: right, y: bottom - k },
    { kind: 'cubic', c1x: right, c1y: bottom - c, c2x: right - c, c2y: bottom, x: right - k, y: bottom },
    { kind: 'line', x: x + k, y: bottom },
    { kind: 'cubic', c1x: x + c, c1y: bottom, c2x: x, c2y: bottom - c, x, y: bottom - k },
    { kind: 'line', x, y: y + k },
    { kind: 'cubic', c1x: x, c1y: y + c, c2x: x + c, c2y: y, x: x + k, y },
    { kind: 'close' }
  ];
}

/** An RGBA bitmap, as a decoded sprite. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** Draw a bitmap at a whole-pixel position and whole-number scale, nearest neighbour: pixel art stays crisp. */
export function drawBitmap(surface: Surface, bitmap: Bitmap, [left, top]: Point, scale: number): void {
  const x0 = Math.round(left);
  const y0 = Math.round(top);
  for (let y = 0; y < bitmap.height * scale; y++) {
    for (let x = 0; x < bitmap.width * scale; x++) {
      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      const from = (sy * bitmap.width + sx) * 4;
      const alpha = bitmap.rgba[from + 3];
      const dx = x0 + x;
      const dy = y0 + y;
      if (alpha > 0 && dx >= 0 && dy >= 0 && dx < surface.width && dy < surface.height) {
        const color: Rgb = [bitmap.rgba[from], bitmap.rgba[from + 1], bitmap.rgba[from + 2]];
        blend(surface, (dy * surface.width + dx) * 3, color, alpha / 255);
      }
    }
  }
}
