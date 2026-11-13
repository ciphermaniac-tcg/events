/**
 * A share image goes where the person can use it: the clipboard, else the
 * share sheet on a touch device, else a download. And the image itself loads
 * its fonts and sprites on demand, leaving out a sprite that will not load.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { mock } from 'node:test';

import { decodePng } from '../../src/lib/shareImage/png.ts';

interface Env {
  clipboard?: { write: (items: unknown[]) => Promise<void> };
  touch?: boolean;
  canShare?: boolean;
  share?: () => Promise<void>;
}

const downloads: string[] = [];
const shared: unknown[] = [];

/** A browser with the given clipboard, pointer and share sheet. */
function browser(env: Env): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      language: 'en-US',
      languages: ['en-US'],
      clipboard: env.clipboard,
      canShare: env.canShare === undefined ? undefined : () => env.canShare,
      share: (data: unknown) => {
        shared.push(data);
        return env.share ? env.share() : Promise.resolve();
      }
    }
  });
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: env.touch === true }),
    document: {
      createElement: () => ({
        click(this: { download: string }) {
          downloads.push(this.download);
        }
      })
    }
  });
}

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}
Object.assign(globalThis, { ClipboardItem: FakeClipboardItem });
mock.timers.enable({ apis: ['setTimeout'] });

const { imageToClipboard } = await import('../../src/lib/shareImage/clipboard.ts');
const { imageName, shareOrSave } = await import('../../src/lib/shareImage/copy.ts');

const png = () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' }));

test('the clipboard takes the image as a promise, written before the image is ready', async () => {
  const written: unknown[] = [];
  browser({
    clipboard: {
      write: items => {
        written.push(...items);
        return Promise.resolve();
      }
    }
  });
  assert.equal(await imageToClipboard(png()), true);
  assert.ok(written[0] instanceof FakeClipboardItem);
  assert.ok((written[0] as FakeClipboardItem).items['image/png'] instanceof Promise);
});

test('a clipboard that refuses the image, throws, or is missing says no', async () => {
  browser({ clipboard: { write: () => Promise.reject(new Error('no')) } });
  assert.equal(await imageToClipboard(png()), false);
  browser({
    clipboard: {
      write: () => {
        throw new Error('sync');
      }
    }
  });
  assert.equal(await imageToClipboard(png()), false);
  browser({});
  assert.equal(await imageToClipboard(png()), false);
});

test('without a touch share sheet, the image downloads', async () => {
  browser({ canShare: true });
  assert.equal(await shareOrSave(await png(), 'desk.png'), 'downloaded');
  assert.equal(downloads.at(-1), 'desk.png');
  browser({});
  assert.equal(await shareOrSave(await png(), 'none.png'), 'downloaded');
});

test('a touch device whose share sheet takes files shares it, and a cancel is not a download', async () => {
  browser({ touch: true, canShare: true });
  assert.equal(await shareOrSave(await png(), 'shared.png'), 'shared');
  assert.ok(shared.length > 0);
  browser({ touch: true, canShare: true, share: () => Promise.reject(new DOMException('no', 'AbortError')) });
  assert.equal(await shareOrSave(await png(), 'cancel.png'), 'cancelled');
  browser({ touch: true, canShare: true, share: () => Promise.reject(new Error('broken')) });
  assert.equal(await shareOrSave(await png(), 'broken.png'), 'downloaded');
  browser({ touch: true, canShare: false });
  assert.equal(await shareOrSave(await png(), 'unshareable.png'), 'downloaded');
});

test('a file name keeps letters of any script and drops the rest', () => {
  assert.equal(imageName(['North Texas Winter Cup', 'Zoë H.']), 'North-Texas-Winter-Cup-Zoë-H.png');
  assert.equal(imageName(['', '...']), 'ciphermaniac.png');
});

// ----- the image ---------------------------------------------------------------

const SPRITE = readFileSync('static/img/substitute.png');
const requests: { url: string; cache?: RequestCache }[] = [];
let fontsDown = false;

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  requests.push({ url, cache: init?.cache });
  const font = /^\/fonts\/(inter-outlines-\d+\.json)$/.exec(url);
  if (font && !fontsDown) {
    return Promise.resolve(new Response(readFileSync(`static/fonts/${font[1]}`)));
  }
  if (url === '/img/substitute.png' || url.endsWith('/gardevoir.png')) {
    return Promise.resolve(new Response(SPRITE));
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
};

const { playerImage, saveImage, spriteSlugs, spriteUrl } = await import('../../src/lib/shareImage/render.ts');
const { DEFAULT_SETTINGS } = await import('../../shared/tournament/view.ts');

const pod = { rounds: [] } as unknown as Parameters<typeof playerImage>[0]['pod'];
const DATA: Parameters<typeof playerImage>[0] = {
  view: {
    tournament: { info: { name: 'Cup', startDate: '10/03/2026' } },
    settings: DEFAULT_SETTINGS
  } as unknown as Parameters<typeof playerImage>[0]['view'],
  pod,
  playerId: 'a',
  standing: { playerId: 'a', place: 1, record: { wins: 0, losses: 0, ties: 0 }, points: 0, owp: 0, oowp: 0 } as never,
  place: '1st in Masters',
  names: new Map([['a', 'Zoë H.']]),
  records: new Map(),
  decks: { a: 'Gardevoir' },
  sprites: () => ['gardevoir', 'missing', 'substitute']
};

test('a font that fails to load fails the image, and is asked for again next time', async () => {
  fontsDown = true;
  await assert.rejects(playerImage(DATA, 'light'), /inter-outlines/);
  fontsDown = false;
  const blob = await playerImage(DATA, 'dark');
  const image = await decodePng(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(image.width, 880, 'twice the scene’s 440 points');
  assert.equal(blob.type, 'image/png');
});

test('sprites load past the HTTP cache once, and one that is missing is asked for again', async () => {
  requests.length = 0;
  const first = await playerImage(DATA, 'light');
  assert.ok(first.size > 0);
  const firstFetch = requests.filter(request => !request.url.startsWith('/fonts/'));
  assert.ok(
    firstFetch.every(request => request.cache === 'no-store'),
    'the first read still skips the HTTP cache'
  );
  requests.length = 0;
  const second = await playerImage(DATA, 'light');
  assert.equal(second.size, first.size);
  const secondFetch = requests.filter(request => !request.url.startsWith('/fonts/'));
  assert.deepEqual(
    secondFetch.map(request => request.url),
    [spriteUrl('missing')],
    'a sprite that loaded is reused; one that did not is asked for again'
  );
  assert.ok(secondFetch.every(request => request.cache === 'no-store'));
  assert.equal(spriteUrl('substitute'), '/img/substitute.png');
});

test('every deck’s first two sprites are asked for once', () => {
  const deck = (sprites: string[]) => ({ label: 'x', sprites });
  const opponent = (sprites: string[]) => ({ name: 'n', record: 'r', deck: deck(sprites) });
  const round = { label: '1', cut: false, note: '', mark: 'W', letter: 'W' } as const;
  assert.deepEqual(
    spriteSlugs({
      event: '',
      date: '',
      name: '',
      place: '',
      record: '',
      points: '',
      owp: '',
      oowp: '',
      deck: deck(['a', 'b', 'c']),
      rounds: [
        { ...round, opponent: opponent(['b', 'd']) },
        { ...round, opponent: null }
      ]
    }),
    ['a', 'b', 'd']
  );
});

test('an image the clipboard would not take is saved under the event’s and the player’s names', async () => {
  browser({});
  assert.equal(await saveImage(png(), DATA), 'downloaded');
  assert.equal(downloads.at(-1), 'Cup-Zoë-H.png');
});
