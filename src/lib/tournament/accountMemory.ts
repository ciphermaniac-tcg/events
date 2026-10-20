/**
 * The signed-in account and its lists, kept for the tab, so a page coming
 * back shows the last answer at once while it reads them again. The lists
 * are kept under the account they belong to, and dropped on sign-out or a
 * History wipe, along with the History rows kept on the device (see keptRows.ts).
 */

import { createResource, type ResourceOptions, type ResourceReturn } from 'solid-js';
import type { OwnHistory, Session, TournamentSummary } from './api';
import { keepBrowserMemory, readBrowserMemory } from './browserMemory';
import { forgetKeptRows } from './keptRows';

interface Lists {
  history: OwnHistory;
  events: TournamentSummary[];
}
type List = keyof Lists;

const LISTS: readonly List[] = ['history', 'events'];
const keyOf = (list: List) => `cm-account-${list}`;
const SESSION = 'cm-account-session';

function readKept<T>(key: string, account: string): T | undefined {
  try {
    const kept = JSON.parse(readBrowserMemory(key) ?? 'null') as { account: string; value: T } | null;
    return kept?.account === account ? kept.value : undefined;
  } catch {
    return undefined;
  }
}

function keptResource<T>(key: string, account: string, read: () => Promise<T>): ResourceReturn<T> {
  const kept = readKept<T>(key, account);
  // Solid counts an initialValue key as an answer even when it holds nothing.
  const options: ResourceOptions<T> = kept === undefined ? {} : { initialValue: kept };
  return createResource(async () => {
    const value = await read();
    keepBrowserMemory(key, JSON.stringify({ account, value }));
    return value;
  }, options);
}

/**
 * The list as a resource: ready at once on the tab's last answer, if one is
 * kept, and refreshing while it is read again. With none kept it waits for
 * its first answer like any other.
 */
export const accountList = <L extends List>(list: L, account: string, read: () => Promise<Lists[L]>) =>
  keptResource(keyOf(list), account, read);

/** Drops the account, its lists and the kept History rows. */
export function forgetAccountMemory(): void {
  keepBrowserMemory(SESSION, null);
  for (const list of LISTS) {
    keepBrowserMemory(keyOf(list), null);
  }
  forgetKeptRows();
}

/** The tab's last signed-in session, if one is kept. A signed-out one is never kept, so signing in is never shown as signed out. */
export function keptSession(): Session | undefined {
  try {
    const kept = JSON.parse(readBrowserMemory(SESSION) ?? 'null') as Session | null;
    return kept?.user ? kept : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keeps a signed-in answer. A signed-out one after a kept session drops
 * everything kept for the account; otherwise the History rows a visitor's
 * profile reads stay.
 */
export function keepSession(answer: Session): void {
  if (answer.user) {
    keepBrowserMemory(SESSION, JSON.stringify(answer));
  } else if (keptSession()) {
    forgetAccountMemory();
  }
}
