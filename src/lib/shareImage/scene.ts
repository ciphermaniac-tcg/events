/**
 * A share image as a list of drawing operations in CSS pixels, and the one
 * function that turns it into pixels at a fixed density. Layouts build a
 * scene from data and a measure function, which keeps them pure and testable;
 * only `renderScene` touches pixels.
 * @module lib/shareImage/scene
 */

import { fit, type FontData, shape, textPath, type TextStyle } from './font';
import { type Bitmap, createSurface, drawBitmap, fillPath, type Rgb, roundedRect, type Surface } from './raster';

/** The weights the outlines ship in. */
export type Weight = 400 | 500 | 600 | 700;

export interface RectOp {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly r?: number;
  readonly color: Rgb;
}

export interface TextOp {
  readonly kind: 'text';
  readonly x: number;
  /** The baseline. */
  readonly y: number;
  readonly text: string;
  readonly size: number;
  readonly weight: Weight;
  readonly color: Rgb;
  readonly tnum?: boolean;
  readonly tracking?: number;
  /** Which edge `x` names. */
  readonly align?: 'left' | 'right' | 'center';
  /** Cut short with an ellipsis past this width. */
  readonly maxWidth?: number;
}

export interface SpriteOp {
  readonly kind: 'sprite';
  /** The box's top left corner and edge; the sprite sits centred in it at a whole-number scale. */
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly slug: string;
  /**
   * Image pixels per sprite pixel. Set it so every sprite in a row draws at
   * one scale; left out, each takes the largest whole scale its box allows.
   */
  readonly scale?: number;
}

export type Op = RectOp | TextOp | SpriteOp;

export interface Scene {
  readonly width: number;
  readonly height: number;
  readonly background: Rgb;
  readonly ops: readonly Op[];
}

/** How layouts ask how wide a run will be, in CSS pixels. */
export type Measure = (text: string, size: number, weight: Weight, tnum?: boolean) => number;

export type Fonts = Readonly<Record<Weight, FontData>>;

/** Pixels in the image for each CSS pixel of the scene, whatever the screen's own ratio. */
export const DENSITY = 2;

/** A measure function over loaded fonts. */
export function measurer(fonts: Fonts): Measure {
  return (text, size, weight, tnum) => shape(text, { face: fonts[weight], size, tnum }).width;
}

function styleOf(op: TextOp, fonts: Fonts, density: number): TextStyle {
  return { face: fonts[op.weight], size: op.size * density, tnum: op.tnum, tracking: op.tracking };
}

function drawText(surface: Surface, op: TextOp, fonts: Fonts, density: number): string[] {
  const style = styleOf(op, fonts, density);
  const text = op.maxWidth === undefined ? op.text : fit(op.text, style, op.maxWidth * density);
  const run = shape(text, style);
  const anchor = op.x * density;
  const left = op.align === 'right' ? anchor - run.width : op.align === 'center' ? anchor - run.width / 2 : anchor;
  fillPath(surface, textPath(run, style, left, op.y * density), op.color);
  return run.missing;
}

function drawSprite(surface: Surface, op: SpriteOp, sprites: ReadonlyMap<string, Bitmap>, density: number): void {
  const bitmap = sprites.get(op.slug);
  if (!bitmap) {
    return;
  }
  const box = op.size * density;
  const scale = op.scale ?? Math.max(1, Math.floor(box / Math.max(bitmap.width, bitmap.height)));
  const left = op.x * density + Math.floor((box - bitmap.width * scale) / 2);
  const top = op.y * density + Math.floor((box - bitmap.height * scale) / 2);
  drawBitmap(surface, bitmap, [left, top], scale);
}

/** What a render made, and any characters it had no outline for. */
export interface Rendered {
  readonly surface: Surface;
  readonly missing: string[];
}

/** Draw a scene at a fixed density. */
export function renderScene(
  scene: Scene,
  fonts: Fonts,
  sprites: ReadonlyMap<string, Bitmap>,
  density = DENSITY
): Rendered {
  const surface = createSurface(scene.width * density, scene.height * density, scene.background);
  const missing: string[] = [];
  for (const op of scene.ops) {
    if (op.kind === 'rect') {
      const d = density;
      fillPath(surface, roundedRect({ x: op.x * d, y: op.y * d, w: op.w * d, h: op.h * d }, (op.r ?? 0) * d), op.color);
    } else if (op.kind === 'text') {
      missing.push(...drawText(surface, op, fonts, density));
    } else {
      drawSprite(surface, op, sprites, density);
    }
  }
  return { surface, missing };
}
