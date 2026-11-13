/**
 * A player's share image as a PNG, loaded the first time someone asks for one:
 * this module, the outlines of Inter (static files the site serves) and the
 * deck sprites all arrive then, so the page itself carries none of it.
 * @module lib/shareImage/render
 */

import { R2_ORIGIN } from '../constants';
import { imageName, type SaveOutcome, shareOrSave } from './copy';
import type { FontData } from './font';
import { headBarScene, type PlayerShare, type ShareTheme } from './headBar';
import { playerShare, type SheetData } from './playerShare';
import { decodePng, encodePng } from './png';
import type { Bitmap } from './raster';
import { type Fonts, measurer, renderScene, type Weight } from './scene';

const WEIGHTS: readonly Weight[] = [400, 500, 600, 700];

/** The slug the page's deck icons use for the Substitute doll, which the site serves itself. */
const SUBSTITUTE = 'substitute';

let fonts: Promise<Fonts> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Every weight the image is set in, fetched once a page; a failed load is asked for again next time. */
function loadFonts(): Promise<Fonts> {
  fonts ??= Promise.all(WEIGHTS.map(weight => fetchJson<FontData>(`/fonts/inter-outlines-${weight}.json`))).then(
    ([w400, w500, w600, w700]) => ({ 400: w400, 500: w500, 600: w600, 700: w700 }),
    (error: unknown) => {
      fonts = null;
      throw error;
    }
  );
  return fonts;
}

export function spriteUrl(slug: string): string {
  return slug === SUBSTITUTE ? '/img/substitute.png' : `${R2_ORIGIN}/pokemon-sprites/gen9/${slug}.png`;
}

/**
 * One sprite's pixels. Fetched past the HTTP cache: the page's own `<img>`
 * may have cached the file without the CORS headers this read needs. The read
 * is kept for the page, so sharing a second sheet does not download it again;
 * a failed read is forgotten and asked for next time.
 */
const sprites = new Map<string, Bitmap>();

async function loadSprite(slug: string): Promise<Bitmap> {
  const cached = sprites.get(slug);
  if (cached) {
    return cached;
  }
  const response = await fetch(spriteUrl(slug), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${slug}: ${response.status}`);
  }
  const sprite = await decodePng(new Uint8Array(await response.arrayBuffer()));
  sprites.set(slug, sprite);
  return sprite;
}

export function spriteSlugs(share: PlayerShare): string[] {
  const decks = [share.deck, ...share.rounds.map(row => row.opponent?.deck ?? null)];
  return [...new Set(decks.flatMap(deck => deck?.sprites.slice(0, 2) ?? []))];
}

/** Every sprite that loads; one that does not is left out of the image. */
async function loadSprites(slugs: readonly string[]): Promise<Map<string, Bitmap>> {
  const settled = await Promise.allSettled(slugs.map(loadSprite));
  const loaded = new Map<string, Bitmap>();
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      loaded.set(slugs[i], result.value);
    }
  });
  return loaded;
}

/** The player's sheet as a share image in the page's light or dark. */
export async function playerImage(data: SheetData, theme: ShareTheme): Promise<Blob> {
  const share = playerShare(data);
  const [faces, sprites] = await Promise.all([loadFonts(), loadSprites(spriteSlugs(share))]);
  const scene = headBarScene(share, measurer(faces), theme);
  return encodePng(renderScene(scene, faces, sprites).surface);
}

/** Share or save the image where the clipboard would not take it, named for the event and the player. */
export async function saveImage(png: Promise<Blob>, data: SheetData): Promise<SaveOutcome> {
  const name = imageName([data.view.tournament.info.name, data.names.get(data.playerId) ?? '']);
  return shareOrSave(await png, name);
}
