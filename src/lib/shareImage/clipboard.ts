/**
 * The first step of copying a share image, the only one the page carries:
 * Safari takes a clipboard write only when it starts inside the click, so the
 * write is called before anything is awaited, with the image as a promise the
 * PNG fills when it is ready. Firefox for Android exposes the API (and says
 * yes to `ClipboardItem.supports`) but rejects an image, so a rejection, not a
 * feature test, sends the image on (see copy.ts).
 * @module lib/shareImage/clipboard
 */

/** Start writing the image to the clipboard; false where the clipboard will not take it. Call it inside the click. */
export function imageToClipboard(png: Promise<Blob>): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
    return Promise.resolve(false);
  }
  try {
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
      () => true,
      () => false
    );
  } catch {
    return Promise.resolve(false);
  }
}
