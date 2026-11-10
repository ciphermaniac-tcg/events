/**
 * A share image the clipboard would not take (see clipboard.ts), put where
 * the person can still send it: the share sheet on a touch device that takes
 * files, a download otherwise. Loaded with the renderer, not the page.
 * @module lib/shareImage/copy
 */

import { downloadBlob } from '../download';

/** Where the image went instead. */
export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled';

/** A phone or tablet whose share sheet takes this file. */
function canShareFile(file: File): boolean {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return touch && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

async function shareFile(file: File): Promise<SaveOutcome | null> {
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : null;
  }
}

/** A file name from its parts ("Winter Cup", "Jun T." to "Winter-Cup-Jun-T.png"), letters of any script kept. */
export function imageName(parts: readonly string[]): string {
  const words = parts.join(' ').replace(/[^\p{L}\p{N}]+/gu, '-');
  return `${words.replace(/^-+|-+$/g, '') || 'ciphermaniac'}.png`;
}

/** Share the image on a touch device that takes files, or save it. */
export async function shareOrSave(blob: Blob, filename: string): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (canShareFile(file)) {
    const shared = await shareFile(file);
    if (shared) {
      return shared;
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
