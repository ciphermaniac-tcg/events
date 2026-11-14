/**
 * Following a file: its modified time checked on a beat, its text read when
 * it changes. Stopping makes any check or read still under way a no-op, so a
 * file linked in its place never shows the old one's contents.
 */

export interface FileIo {
  modified: (path: string) => Promise<number>;
  read: (path: string) => Promise<string>;
}

export interface Follow {
  /** Checks the file once; resolves when that check is done. */
  look: () => Promise<void>;
  stop: () => void;
}

/**
 * Calls `take` with the file's text now and after every save. A save `take`
 * throws on (TOM caught halfway through writing) is read again next time.
 */
export function follow(path: string, io: FileIo, take: (text: string) => void, fail: (err: unknown) => void): Follow {
  let seen: number | null = null;
  let busy = false;
  let live = true;
  async function check() {
    const modified = await io.modified(path);
    if (modified === seen) {
      return;
    }
    const text = await io.read(path);
    if (live) {
      take(text);
      seen = modified;
    }
  }
  async function look() {
    if (busy || !live) {
      return;
    }
    busy = true;
    try {
      await check();
    } catch (err) {
      if (live) {
        fail(err);
      }
    } finally {
      busy = false;
    }
  }
  return {
    look,
    stop: () => {
      live = false;
    }
  };
}
