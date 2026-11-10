/**
 * PNG in and out without a canvas. Encoding here, not through
 * `canvas.toBlob`, keeps canvas readback (which Firefox and Safari can salt
 * with noise against fingerprinting) out of the picture; decoding here keeps
 * a sprite's colour profile from being applied differently by each engine.
 * The deflate itself is the browser's `CompressionStream`, which is lossless.
 * @module lib/shareImage/png
 */

import type { Bitmap, Surface } from './raster';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/**
 * Scanlines with the Sub filter: flat panels and text on a plain ground
 * compress well under it, and a fixed filter keeps the bytes before deflate
 * the same everywhere.
 */
export function filteredScanlines(surface: Surface): Uint8Array {
  const stride = surface.width * 3;
  const out = new Uint8Array((stride + 1) * surface.height);
  for (let y = 0; y < surface.height; y++) {
    const from = y * stride;
    const to = y * (stride + 1);
    out[to] = 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? surface.pixels[from + i - 3] : 0;
      out[to + 1 + i] = (surface.pixels[from + i] - left) & 0xff;
    }
  }
  return out;
}

/** An opaque RGB PNG of the surface, tagged sRGB. */
export async function encodePng(surface: Surface): Promise<Blob> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, surface.width);
  view.setUint32(4, surface.height);
  header[8] = 8;
  header[9] = 2;
  const data = await pipe(filteredScanlines(surface), new CompressionStream('deflate'));
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', header),
    chunk('sRGB', new Uint8Array([0])),
    chunk('IDAT', data),
    chunk('IEND', new Uint8Array(0))
  ];
  return new Blob(parts as BlobPart[], { type: 'image/png' });
}

interface PngParts {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace: number;
  palette: Uint8Array;
  transparency: Uint8Array;
  data: Uint8Array[];
}

function readChunks(bytes: Uint8Array): PngParts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: PngParts = {
    width: 0,
    height: 0,
    depth: 0,
    colorType: 0,
    interlace: 0,
    palette: new Uint8Array(0),
    transparency: new Uint8Array(0),
    data: []
  };
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      parts.width = view.getUint32(at + 8);
      parts.height = view.getUint32(at + 12);
      [parts.depth, parts.colorType, , , parts.interlace] = body.subarray(8, 13);
    } else if (type === 'PLTE') {
      parts.palette = body;
    } else if (type === 'tRNS') {
      parts.transparency = body;
    } else if (type === 'IDAT') {
      parts.data.push(body);
    }
    at += 12 + length;
  }
  return parts;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function predictor(filter: number, a: number, b: number, c: number): number {
  switch (filter) {
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4:
      return paeth(a, b, c);
    default:
      return 0;
  }
}

/** Undo the per-row filters, giving packed rows of `stride` bytes. */
function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const at = y * stride + i;
      const a = i >= bpp ? out[at - bpp] : 0;
      const b = y > 0 ? out[at - stride] : 0;
      const c = y > 0 && i >= bpp ? out[at - stride - bpp] : 0;
      out[at] = (raw[y * (stride + 1) + 1 + i] + predictor(filter, a, b, c)) & 0xff;
    }
  }
  return out;
}

/** One sample of a row, at any bit depth up to 8. */
function sample(row: Uint8Array, start: number, index: number, depth: number): number {
  if (depth === 8) {
    return row[start + index];
  }
  const bit = index * depth;
  const byte = row[start + (bit >> 3)];
  return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
}

function pixelOf(parts: PngParts, rows: Uint8Array, start: number, x: number): [number, number, number, number] {
  const n = CHANNELS[parts.colorType];
  const s = (i: number) => sample(rows, start, x * n + i, parts.depth);
  const scale = 255 / ((1 << parts.depth) - 1);
  switch (parts.colorType) {
    case 3: {
      const index = s(0);
      const alpha = index < parts.transparency.length ? parts.transparency[index] : 255;
      return [parts.palette[index * 3], parts.palette[index * 3 + 1], parts.palette[index * 3 + 2], alpha];
    }
    case 0:
      return [s(0) * scale, s(0) * scale, s(0) * scale, 255];
    case 4:
      return [s(0), s(0), s(0), s(1)];
    case 2:
      return [s(0), s(1), s(2), 255];
    default:
      return [s(0), s(1), s(2), s(3)];
  }
}

/**
 * Decode a non-interlaced PNG of up to 8 bits a sample into RGBA. Colour
 * profiles and gamma are ignored on purpose: the sprites are sRGB already.
 */
export async function decodePng(bytes: Uint8Array): Promise<Bitmap> {
  const parts = readChunks(bytes);
  const channels = CHANNELS[parts.colorType];
  if (parts.interlace !== 0 || parts.depth > 8 || channels === undefined) {
    throw new Error('unsupported PNG');
  }
  const joined = new Uint8Array(parts.data.reduce((sum, d) => sum + d.length, 0));
  let offset = 0;
  for (const d of parts.data) {
    joined.set(d, offset);
    offset += d.length;
  }
  const raw = await pipe(joined, new DecompressionStream('deflate'));
  const stride = Math.ceil((parts.width * channels * parts.depth) / 8);
  const rows = unfilter(raw, parts.height, stride, Math.max(1, (channels * parts.depth) >> 3));
  const rgba = new Uint8Array(parts.width * parts.height * 4);
  for (let y = 0; y < parts.height; y++) {
    for (let x = 0; x < parts.width; x++) {
      rgba.set(pixelOf(parts, rows, y * stride, x), (y * parts.width + x) * 4);
    }
  }
  return { width: parts.width, height: parts.height, rgba };
}
