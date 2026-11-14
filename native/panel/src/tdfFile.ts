/**
 * The .tdf TOM saves to, picked through the system dialog and read through
 * the fs plugin. Following it checks the modified time every two seconds and
 * reads the file when TOM has saved.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, stat } from '@tauri-apps/plugin-fs';

const POLL_MS = 2000;
const REMEMBERED = 'tom-panel-tdf';

interface Filter {
  name: string;
  extensions: string[];
}

/** One file from the system dialog, or null when the organizer cancels. */
export async function pickFile(filters: Filter[] = []): Promise<string | null> {
  const picked = await open({ multiple: false, directory: false, filters });
  return typeof picked === 'string' ? picked : null;
}

export const pickTdf = () => pickFile([{ name: 'TOM tournament', extensions: ['tdf'] }]);

export function recallTdf(): string | null {
  try {
    return localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
}

export function rememberTdf(path: string | null) {
  try {
    if (path) {
      localStorage.setItem(REMEMBERED, path);
    } else {
      localStorage.removeItem(REMEMBERED);
    }
  } catch {
    // Storage refused: the file is still followed, only not after a restart.
  }
}

/**
 * Calls `take` with the file's text now and after every save. A save `take`
 * throws on (TOM caught halfway through writing) is read again next time.
 * Returns what stops following it.
 */
export function followFile(path: string, take: (text: string) => void, fail: (err: unknown) => void): () => void {
  let seen: number | null = null;
  let busy = false;
  const look = async () => {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const modified = (await stat(path)).mtime?.getTime() ?? 0;
      if (modified !== seen) {
        take(await readTextFile(path));
        seen = modified;
      }
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  };
  void look();
  const timer = setInterval(() => void look(), POLL_MS);
  return () => clearInterval(timer);
}

/** The file's name, without its folders. */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
