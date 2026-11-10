/** The share image renderer: exact coverage, kerning and fitting, PNG round trips, a fixed picture. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fit, type FontData, shape } from '../../src/lib/shareImage/font.ts';
import { decodePng, encodePng } from '../../src/lib/shareImage/png.ts';
import { createSurface, fillPath, roundedRect } from '../../src/lib/shareImage/raster.ts';
import { type Fonts, measurer, renderScene } from '../../src/lib/shareImage/scene.ts';

/** A font of squares: "a" and "b" a 1000-unit box on a 1000 em, "1" narrower until tabular. */
const SQUARE = 'M0 0L0 700L600 700L600 0Z';
const FACE: FontData = {
  upm: 1000,
  asc: 900,
  desc: -200,
  cap: 700,
  x: 500,
  g: { a: [1000, SQUARE], b: [1000, SQUARE], '1': [500, SQUARE], '…': [1000, SQUARE], ' ': [250, ''] },
  t: { '1': [800, SQUARE] },
  k: { l: { a: 0 }, r: { b: 0 }, m: { '0,0': -100 } }
};
const FONTS: Fonts = { 400: FACE, 500: FACE, 600: FACE, 700: FACE };

test('a rectangle on whole pixels fills them exactly, and a half-covered column takes half the colour', () => {
  const surface = createSurface(4, 2, [255, 255, 255]);
  fillPath(surface, roundedRect({ x: 0, y: 0, w: 2.5, h: 2 }, 0), [0, 0, 0]);
  const row = Array.from(surface.pixels.subarray(0, 12));
  assert.deepEqual(row, [0, 0, 0, 0, 0, 0, 128, 128, 128, 255, 255, 255]);
});

test('text takes kerning between classed pairs and tabular figures when asked', () => {
  assert.equal(shape('ab', { face: FACE, size: 10 }).width, 19, 'a then b kerns by -100 units');
  assert.equal(shape('ba', { face: FACE, size: 10 }).width, 20);
  assert.equal(shape('1', { face: FACE, size: 10 }).width, 5);
  assert.equal(shape('1', { face: FACE, size: 10, tnum: true }).width, 8);
  assert.deepEqual(shape('a一', { face: FACE, size: 10 }).missing, ['一'], 'an uncovered character is reported');
});

test('a run too wide is cut short with an ellipsis that fits', () => {
  const style = { face: FACE, size: 10 };
  assert.equal(fit('aaaa', style, 40), 'aaaa');
  const cut = fit('aaaa aaaa', style, 40);
  assert.equal(cut, 'aaa…');
  assert.ok(shape(cut, style).width <= 40);
});

test('a PNG made here decodes back to the same pixels', async () => {
  const surface = createSurface(3, 2, [10, 200, 30]);
  surface.pixels.set([255, 0, 0], 9);
  const bytes = new Uint8Array(await (await encodePng(surface)).arrayBuffer());
  const back = await decodePng(bytes);
  assert.equal(back.width, 3);
  assert.equal(back.height, 2);
  assert.deepEqual(Array.from(back.rgba.subarray(12, 16)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(back.rgba.subarray(0, 4)), [10, 200, 30, 255]);
});

test('a palette sprite with transparency decodes with its clear pixels clear', async () => {
  const sprite = await decodePng(new Uint8Array(readFileSync('static/img/substitute.png')));
  assert.ok(sprite.width > 0 && sprite.height > 0);
  assert.equal(sprite.rgba[3], 0, 'the top left corner is transparent');
  assert.ok(
    Array.from({ length: sprite.width * sprite.height }, (_, i) => sprite.rgba[i * 4 + 3]).some(a => a === 255)
  );
});

test('a scene renders to the same pixels every time, at a fixed density whatever the screen', () => {
  const m = measurer(FONTS);
  const scene = {
    width: 60,
    height: 20,
    background: [255, 255, 255] as const,
    ops: [
      { kind: 'rect' as const, x: 1, y: 1, w: 58, h: 18, r: 6, color: [227, 228, 225] as const },
      {
        kind: 'text' as const,
        x: 4,
        y: 15,
        text: 'ab1',
        size: 13,
        weight: 600 as const,
        color: [32, 34, 31] as const,
        tnum: true
      },
      {
        kind: 'text' as const,
        x: 56,
        y: 15,
        text: 'ba',
        size: 11,
        weight: 400 as const,
        color: [140, 89, 0] as const,
        align: 'right' as const
      }
    ]
  };
  const rendered = renderScene(scene, FONTS, new Map());
  assert.equal(rendered.surface.width, 120);
  assert.equal(m('ab', 10, 400), 19);
  const digest = createHash('sha256').update(rendered.surface.pixels).digest('hex');
  assert.equal(
    digest,
    createHash('sha256')
      .update(renderScene(scene, FONTS, new Map()).surface.pixels)
      .digest('hex')
  );
  assert.equal(digest.slice(0, 16), '6873e858f86e46a0');
});

test('a sprite given a scale draws at that scale, not the largest its box allows', () => {
  const dot = { width: 2, height: 1, rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]) };
  const inked = (scale?: number) => {
    const scene = {
      width: 20,
      height: 20,
      background: [255, 255, 255] as const,
      ops: [{ kind: 'sprite' as const, x: 0, y: 0, size: 20, slug: 'dot', ...(scale ? { scale } : {}) }]
    };
    const { pixels } = renderScene(scene, FONTS, new Map([['dot', dot]])).surface;
    return pixels.filter((_, i) => i % 3 === 0 && pixels[i] === 0).length;
  };
  assert.equal(inked(), 2 * 20 * 20, 'without a scale it fills the 40px box, 20 times over');
  assert.equal(inked(1), 2);
  assert.equal(inked(2), 8);
});
