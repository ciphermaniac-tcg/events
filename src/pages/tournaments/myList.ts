/**
 * The registration this device or account holds at an event, read once for
 * the event page: its Registered card and the registration tab's form and
 * receipt alike. A device that kept a list reads it with its token; one that
 * kept none reads the account's own, and no token. Either asks for its own
 * list only (`own`), which spends nothing of the lookups a registration makes.
 */

import { type Accessor, createEffect, createMemo, createResource, on, onCleanup } from 'solid-js';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { type Decklist, lookUpRegistration } from '../../lib/tournament/api';
import { askOnReturn } from '../../lib/tournament/viewPoll';
import { latestValue } from '../../lib/resource';
import { emptyProfile } from './ProfileFields';
import { recall } from './decklistMemory';

/** Whose list the signed-in account owns: its POP ID, or the full name of its Claim. */
type ListOwner = Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>;

async function loadMine([code, owner]: readonly [string, ListOwner | null]): Promise<Decklist | null> {
  const kept = recall(code);
  if (kept) {
    return (await lookUpRegistration(code, kept.profile ?? emptyProfile(), { token: kept.token, own: '1' })).mine;
  }
  return owner ? (await lookUpRegistration(code, owner, { own: '1' })).mine : null;
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
  return {
    state,
    retry: () => void refetch(),
    current: () => latestValue(mine) ?? null,
    reread,
    owner,
    /** Whether the device reads its list by the token it kept, whoever is signed in. */
    byToken: () => recall(code) !== null
  };
}

export type MyList = ReturnType<typeof createMyList>;

/** How long a page back in view waits after reading the registration before it reads it again. */
const REREAD_MS = 30_000;

/**
 * Staff tick check-in without publishing the event, so no poll hears of it:
 * until round 1 is paired (`started`), each time the page is back in view it
 * reads the registration again for the page to hold, at most once every 30
 * seconds. The newest read wins: one asked before another, one for an owner
 * since changed, or one a save from the form overtook is dropped. A read
 * held for an account is let go once the account changes, so the page shows
 * the new owner's; a device's own list, read by its token, stays.
 */
export function createListRereads(
  list: MyList,
  started: Accessor<boolean>,
  held: Accessor<Decklist | null | undefined>,
  hold: (list: Decklist | null | undefined) => void
) {
  let asked = 0;
  async function reread() {
    asked += 1;
    const ask = asked;
    const before = held();
    const fresh = await list.reread().catch(() => undefined);
    if (fresh !== undefined && ask === asked && held() === before) {
      hold(fresh);
    }
  }
  createEffect(
    on(
      list.owner,
      () => {
        asked += 1;
        if (!list.byToken()) {
          hold(undefined);
        }
      },
      { defer: true }
    )
  );
  onCleanup(askOnReturn(() => !started() && void reread(), Date.now, REREAD_MS));
}
