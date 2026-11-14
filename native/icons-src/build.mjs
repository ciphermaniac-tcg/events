// Builds the app's icon set from the Ember masters next to this file.
// Usage: node native/icons-src/build.mjs
// Renders with the repo's Playwright Chromium (run `npm ci` at the repo root first).
//
// mac/      rounded-square plate on Apple's 824/1024 grid; icon-32 and icon-16 are drawn for those sizes
// windows/  standalone mark, no plate; icon-24 serves 20 to 32 px, icon-16 serves 16 px
// android/  adaptive layers at 108 dp (foreground, background, monochrome)
// tahoe/    macOS 26 Icon Composer layers, kept for when the bundler can ship an .icon
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, '..', 'src-tauri', 'icons');
const resDir = join(here, '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');

const master = rel => readFileSync(join(here, rel), 'utf8');
const MAC = { L: master('mac/icon.svg'), M: master('mac/icon-32.svg'), S: master('mac/icon-16.svg') };
const WIN = { L: master('windows/icon.svg'), M: master('windows/icon-24.svg'), S: master('windows/icon-16.svg') };
const ANDROID = {
  foreground: master('android/foreground.svg'),
  background: master('android/background.svg'),
  monochrome: master('android/monochrome.svg')
};

// The small drawings take over at the sizes they were drawn for.
const drawingFor = (set, px) => (px <= 16 ? set.S : px <= 32 ? set.M : set.L);

const dataUri = svg => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

function write(file, bytes) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

async function render(page, svg, px) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img id="i" width="${px}" height="${px}" src="${dataUri(svg)}" style="display:block"></body></html>`
  );
  await page.evaluate(() => document.getElementById('i').decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
}

// Straight (not premultiplied) RGBA bytes of a PNG.
async function pixels(page, png) {
  const bytes = await page.evaluate(
    async src => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(0, 0, img.width, img.height).data);
    },
    `data:image/png;base64,${png.toString('base64')}`
  );
  return Buffer.from(bytes);
}

// --- .icns -----------------------------------------------------------------

function runLength(bytes, start) {
  let run = 1;
  while (start + run < bytes.length && run < 130 && bytes[start + run] === bytes[start]) {
    run++;
  }
  return run;
}

// The icns flavour of PackBits: 0x00-0x7f copies n + 1 bytes, 0x80-0xff repeats one byte n - 0x80 + 3 times.
function packBits(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const run = runLength(bytes, i);
    if (run >= 3) {
      out.push(0x80 + run - 3, bytes[i]);
      i += run;
      continue;
    }
    let end = i;
    while (end < bytes.length && end - i < 128 && runLength(bytes, end) < 3) {
      end++;
    }
    out.push(end - i - 1, ...bytes.subarray(i, end));
    i = end;
  }
  return Buffer.from(out);
}

function channel(rgba, offset) {
  const out = Buffer.alloc(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = rgba[i * 4 + offset];
  }
  return out;
}

// The legacy 16 and 32 px entries: run-length RGB plus an 8-bit mask, read by every macOS version.
function legacyEntries(rgba, rgbType, maskType) {
  const rgb = Buffer.concat([0, 1, 2].map(c => packBits(channel(rgba, c))));
  return [
    [rgbType, rgb],
    [maskType, channel(rgba, 3)]
  ];
}

function icns(entries) {
  const chunk = ([type, data]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  };
  const body = Buffer.concat(entries.map(chunk));
  return chunk(['icns', body]);
}

async function buildIcns(page) {
  const png = px => render(page, drawingFor(MAC, px), px);
  const p16 = await png(16);
  const p32 = await png(32);
  const png64 = await png(64);
  const png128 = await png(128);
  const png256 = await png(256);
  const png512 = await png(512);
  const png1024 = await png(1024);
  return icns([
    ['ic11', p32], // 16@2x
    ['ic07', png128],
    ['ic13', png256], // 128@2x
    ...legacyEntries(await pixels(page, p16), 'is32', 's8mk'),
    ['ic09', png512],
    ['ic08', png256],
    ['ic10', png1024], // 512@2x
    ...legacyEntries(await pixels(page, p32), 'il32', 'l8mk'),
    ['ic14', png512], // 256@2x
    ['ic12', png64] // 32@2x
  ]);
}

// --- .ico ------------------------------------------------------------------

function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([px, png], i) => {
    const at = 6 + i * 16;
    header.writeUInt8(px % 256, at);
    header.writeUInt8(px % 256, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(([, png]) => png)]);
}

async function buildWindows(page) {
  const sizes = [16, 24, 32, 48, 64, 256];
  const images = [];
  for (const px of sizes) {
    images.push([px, await render(page, drawingFor(WIN, px), px)]);
  }
  write(join(iconsDir, 'icon.ico'), ico(images));

  // Tauri's appx logos.
  for (const px of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
    write(join(iconsDir, `Square${px}x${px}Logo.png`), await render(page, drawingFor(WIN, px), px));
  }
  write(join(iconsDir, 'StoreLogo.png'), await render(page, drawingFor(WIN, 50), 50));
}

async function buildDesktopPngs(page) {
  const files = { '32x32.png': 32, '64x64.png': 64, '128x128.png': 128, '128x128@2x.png': 256, 'icon.png': 512 };
  for (const [name, px] of Object.entries(files)) {
    write(join(iconsDir, name), await render(page, drawingFor(MAC, px), px));
  }
}

// --- Android ---------------------------------------------------------------

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// Android 7 has no adaptive icons: show the middle 72 of the 108 dp layers, clipped to a shape.
function legacyLauncher(shape) {
  const inset = 1024 / 6;
  const side = (1024 * 2) / 3;
  const clip =
    shape === 'round'
      ? `<circle cx="512" cy="512" r="${side / 2}"/>`
      : `<rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${side * 0.18}"/>`;
  const layer = svg => `<image href="${dataUri(svg)}" width="1024" height="1024"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${inset} ${inset} ${side} ${side}">` +
    `<defs><clipPath id="k">${clip}</clipPath></defs>` +
    `<g clip-path="url(#k)">${layer(ANDROID.background)}${layer(ANDROID.foreground)}</g></svg>`
  );
}

async function buildAndroid(page) {
  const launchers = [
    ['ic_launcher', legacyLauncher('square')],
    ['ic_launcher_round', legacyLauncher('round')]
  ];
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const dir = join(resDir, `mipmap-${density}`);
    for (const [layer, svg] of Object.entries(ANDROID)) {
      write(join(dir, `ic_launcher_${layer}.png`), await render(page, svg, 108 * scale));
    }
    for (const [name, svg] of launchers) {
      write(join(dir, `${name}.png`), await render(page, svg, 48 * scale));
    }
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    write(join(iconsDir, 'icon.icns'), await buildIcns(page));
    await buildDesktopPngs(page);
    await buildWindows(page);
    await buildAndroid(page);
  } finally {
    await browser.close();
  }
}

await main();
