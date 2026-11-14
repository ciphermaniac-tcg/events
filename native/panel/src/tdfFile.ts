/**
 * The .tdf TOM saves to, picked through the system dialog and read through
 * the fs plugin. Following it checks the modified time every two seconds and
 * reads the file when TOM has saved.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, stat } from '@tauri-apps/plugin-fs';
import { type FileIo, follow } from './follow';

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

const tauriIo: FileIo = {
  modified: async path => (await stat(path)).mtime?.getTime() ?? 0,
  read: readTextFile
};

/** Follows a file every two seconds (see follow.ts); returns what stops following it. */
export function followFile(path: string, take: (text: string) => void, fail: (err: unknown) => void): () => void {
  const following = follow(path, tauriIo, take, fail);
  void following.look();
  const timer = setInterval(() => void following.look(), POLL_MS);
  return () => {
    clearInterval(timer);
    following.stop();
  };
}

/** The file's name, without its folders. */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
