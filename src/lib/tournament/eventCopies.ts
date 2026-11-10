/**
 * The last copy of an event this device saw, kept so a page reloaded with no
 * signal (a phone that dropped the tab in the background) still shows the
 * player's table instead of an error. Only what the public sees is kept: a
 * staff copy holds names and decks the public does not, so it never is.
 *
 * When several copies meet, the newest version wins: a copy is only written
 * over an older one (two tabs, or answers out of order, never put an older
 * one back), and the page takes a fresh copy over a kept one only when it is
 * no older (see accept in PublicEvent). Nothing a player sends is kept or
 * queued here, so nothing they did offline comes back to collide with it.
 * Three events at most, each dropped a day after it finishes.
 */

import { DAY_MS } from '../../../shared/tournament/limits';
import type { TournamentView, Viewer } from '../../../shared/tournament/view';
import { keepBrowserMemory, readBrowserMemory } from './browserMemory';

const PREFIX = 'cm-event-copy:';
const INDEX = 'cm-event-copies';
const MAX_KEPT = 3;
const NOBODY: Viewer = { role: null, me: null, via: null, signedIn: false };

/** A kept copy, and when this device last heard it from the event. */
interface EventCopy {
  view: TournamentView;
  savedAt: number;
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(readBrowserMemory(key, true) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

const keptCodes = () => readJson<string[]>(INDEX) ?? [];

const expired = (copy: EventCopy, now: number) => copy.view.settings.finished && now - copy.savedAt > DAY_MS;

function drop(code: string): void {
  keepBrowserMemory(PREFIX + code, null, true);
  keepBrowserMemory(INDEX, JSON.stringify(keptCodes().filter(kept => kept !== code)), true);
}

/** The kept copy of `code`, unless it finished more than a day ago, which drops it. */
export function readEventCopy(code: string, now: number): EventCopy | null {
  const copy = readJson<EventCopy>(PREFIX + code);
  if (copy && expired(copy, now)) {
    drop(code);
    return null;
  }
  return copy;
}

/** Keeps `view` as its event's copy, if the public sees all of it and it is no older than the one kept. */
export function keepEventCopy(view: TournamentView, now: number): void {
  if (view.viewer.role !== null) {
    return;
  }
  const kept = readJson<EventCopy>(PREFIX + view.code);
  if (kept && kept.view.version > view.version) {
    return;
  }
  const copy: EventCopy = { view: { ...view, viewer: NOBODY }, savedAt: now };
  keepBrowserMemory(PREFIX + view.code, JSON.stringify(copy), true);
  const codes = [...keptCodes().filter(code => code !== view.code), view.code];
  for (const old of codes.splice(0, Math.max(0, codes.length - MAX_KEPT))) {
    keepBrowserMemory(PREFIX + old, null, true);
  }
  keepBrowserMemory(INDEX, JSON.stringify(codes), true);
}
