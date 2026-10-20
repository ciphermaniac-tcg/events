/**
 * Where History's rows read their events from: each event's public copy on
 * R2, as the event page reads it (see history.ts for what a row takes out of
 * it). A long History therefore costs reads at the edge, not function
 * requests: a page asks for a copy only as its row comes into view, four at
 * a time. A copy the edge does not have yet comes from the API, as on the
 * event page.
 *
 * A finished event's row is also kept on the device, under the version it
 * was read at, so the next visit shows it without asking for the copy at all.
 * Any change to the event bumps its version, which History lists, so a row
 * kept from before a correction is read again. A live or upcoming event is
 * asked of the edge each time.
 */

import type { HistoryEntry } from '../../../shared/accounts/types';
import type { PublishedView } from '../../../shared/tournament/view';
import { createLimiter } from '../concurrency';
import { locale } from '../i18n';
import { fetchPublished, fetchView } from './api';
import { type EntryResult, readEntry } from './history';
import { keepRow, type KeptRow, readKeptRow } from './keptRows';

/** The event's copy: the edge's, or the API's when the edge has none. */
async function copyOf(entry: HistoryEntry): Promise<PublishedView | null> {
  const cache = entry.status === 'finished' ? 'default' : 'no-cache';
  const published = await fetchPublished(entry.code, cache).catch(() => null);
  return published ?? fetchView(entry.code);
}

/** One player's row at one event: a profile's rows and the account's own share events. */
const rowId = (entry: HistoryEntry) => `${entry.code}:${entry.key}`;

/** The finished entry's row as kept on the device, when it is still the event's current one. */
function recalled(entry: HistoryEntry): EntryResult | null {
  const kept = entry.status === 'finished' ? readKeptRow(rowId(entry)) : null;
  const current = kept && kept.version >= entry.version && kept.locale === locale();
  return current ? { finish: kept.finish, names: new Map(kept.names), decks: kept.decks } : null;
}

/** Only the player and their opponents, which is all a row shows. */
function trimmed(entry: HistoryEntry, result: EntryResult): Pick<KeptRow, 'names' | 'decks'> {
  const people = new Set([entry.key, ...result.finish.rounds.flatMap(row => (row.opponent ? [row.opponent] : []))]);
  const names = [...result.names].filter(([id]) => people.has(id));
  const decks = Object.fromEntries(Object.entries(result.decks).filter(([id]) => people.has(id)));
  return { names, decks };
}

/** Keeps a finished entry's row, unless the copy read is older than History says the event is. */
function keep(entry: HistoryEntry, version: number, result: EntryResult): void {
  if (entry.status === 'finished' && version >= entry.version) {
    keepRow(rowId(entry), { version, locale: locale(), finish: result.finish, ...trimmed(entry, result) });
  }
}

const limit = createLimiter(4);

/** Reads one entry's event, waiting its turn behind the other rows' reads, unless the device has kept it. */
export function loadEntry(entry: HistoryEntry): Promise<EntryResult | null> {
  const kept = recalled(entry);
  if (kept) {
    return Promise.resolve(kept);
  }
  return limit(async () => {
    const view = await copyOf(entry);
    const result = view ? readEntry(entry, view) : null;
    if (view && result) {
      keep(entry, view.version, result);
    }
    return result;
  });
}
