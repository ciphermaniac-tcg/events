/**
 * The registration this device or account holds at an event, read once for
 * the event page: its Registered card and the registration tab's form and
 * receipt alike. A device that kept a list reads it with its token; one that
 * kept none reads the account's own, and no token.
 */

import { type Accessor, createEffect, createMemo, createResource, on } from 'solid-js';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { type Decklist, lookUpRegistration } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { emptyProfile } from './ProfileFields';
import { recall } from './decklistMemory';

/** Whose list the signed-in account owns: its POP ID, or the full name of its Claim. */
type ListOwner = Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>;

async function loadMine([code, owner]: readonly [string, ListOwner | null]): Promise<Decklist | null> {
  const kept = recall(code);
  if (kept) {
    return (await lookUpRegistration(code, kept.profile ?? emptyProfile(), { token: kept.token })).mine;
  }
  return owner ? (await lookUpRegistration(code, owner)).mine : null;
}

/** Whether the device knows its list yet: still reading it, the read failed, or known (a list, or none). */
export type ListState = 'loading' | 'failed' | 'known';

/** `wanted`: whether anything on the page shows the list now, so a page that shows none reads none. */
export function createMyList(code: string, owner: () => ListOwner | null, wanted: () => boolean) {
  const kept = recall(code);
  // Read again only for another owner, not for every new copy of the event the owner comes from; a device's own list has none.
  const whose = createMemo(() => wanted() && ([code, kept ? null : owner()] as const), undefined, {
    equals: (a, b) => a === b || (a !== false && b !== false && a[1] === b[1])
  });
  const [mine, { refetch }] = createResource(whose, loadMine);
  const state = (): ListState => {
    if (mine.error) {
      return 'failed';
    }
    return mine.state === 'ready' || mine.state === 'refreshing' ? 'known' : 'loading';
  };
  // A fresh read for the page to hold, apart from the one the form opened on; undefined with nothing to read it by.
  const reread = async () => {
    const by = owner();
    return recall(code) || by ? loadMine([code, by]) : undefined;
  };
  return { state, retry: () => void refetch(), current: () => latestValue(mine) ?? null, reread };
}

export type MyList = ReturnType<typeof createMyList>;

/**
 * Staff ticking check-in makes a new version of the event, so each new
 * `version` (false while none matters) reads the registration again for the
 * page to hold.
 */
export function createListRereads(
  list: MyList,
  version: Accessor<number | false>,
  held: Accessor<Decklist | null | undefined>,
  hold: (list: Decklist | null) => void
) {
  async function reread() {
    const before = held();
    const fresh = await list.reread().catch(() => undefined);
    // A save from the form while reading is newer than the read.
    if (fresh !== undefined && held() === before) {
      hold(fresh);
    }
  }
  createEffect(on(createMemo(version), at => at !== false && void reread(), { defer: true }));
}
