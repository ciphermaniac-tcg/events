/**
 * History rows kept on the device (see historyCopies.ts), each under its
 * event and player, the newest 200 only. Kept apart from the code that reads
 * events, so signing out can drop them without loading it.
 */

import { keepBrowserMemory, readBrowserMemory } from './browserMemory';
import type { PlayerFinish } from './history';

const PREFIX = 'cm-history-row:';
const INDEX = 'cm-history-rows';
/** More finished events than most players' History holds; the oldest kept go first. */
const MAX_KEPT = 200;

/** A row as kept: its round names are in the language it was read in, so another one reads it again. */
export interface KeptRow {
  version: number;
  locale: string;
  finish: PlayerFinish;
  names: [string, string][];
  decks: Record<string, string>;
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(readBrowserMemory(key, true) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

const keptIds = () => readJson<string[]>(INDEX) ?? [];

export const readKeptRow = (id: string) => readJson<KeptRow>(PREFIX + id);

/** Keeps the row as the newest, letting the oldest past the limit go. */
export function keepRow(id: string, row: KeptRow): void {
  keepBrowserMemory(PREFIX + id, JSON.stringify(row), true);
  const ids = [...keptIds().filter(kept => kept !== id), id];
  for (const dropped of ids.splice(0, Math.max(0, ids.length - MAX_KEPT))) {
    keepBrowserMemory(PREFIX + dropped, null, true);
  }
  keepBrowserMemory(INDEX, JSON.stringify(ids), true);
}

/** Drops every kept row, on sign-out or once History is wiped. */
export function forgetKeptRows(): void {
  for (const id of keptIds()) {
    keepBrowserMemory(PREFIX + id, null, true);
  }
  keepBrowserMemory(INDEX, null, true);
}
