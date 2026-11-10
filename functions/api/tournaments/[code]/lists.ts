/**
 * GET /api/tournaments/:code/lists — the public keys of the players whose
 * list can be read here, a pasted one, as { players }, so the page can mark
 * whose name opens a list. Paper lists and players who sent none are left out.
 *
 * GET /api/tournaments/:code/lists?player=<public key> — one player's list,
 * for anyone, once the organizer has opened the event's lists and round 1 is
 * paired (see listsPublic). The player is named by the key the public view
 * knows them by, never their Player ID. Answers { list }: the pasted text,
 * the word that it was handed in on paper, or null when the player sent none
 * (or the event ended and a minor's cards went with it, see store.ts). A late
 * entrant's list stays private while they may still change it (see
 * decklistOpenFor), so every list read here is a locked one.
 */

import { decklistMatcher } from '../../../../shared/tournament/identify.js';
import { decklistOpenFor } from '../../../../shared/tournament/lateLists.js';
import { isSanctioned, listsPublic, type OpenList } from '../../../../shared/tournament/view.js';
import { createRateLimiter, rateLimitAddress } from '../../../lib/api/rateLimiter.js';
import { jsonError, jsonResponse } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { open } from '../../../lib/tournaments/access.js';
import type { TournamentRow } from '../../../lib/tournaments/store.js';
import { msg } from '../../../../shared/i18n.js';

interface ListRow {
  pop_id: string;
  first_name: string;
  last_name: string;
  deck: string;
  deck_mode: string;
}

/** Whether a list is public depends on settings staff can change, so no cache may keep a copy past that change. */
const CACHE = 'no-store';

/** The player a public key names, or undefined when it names none. */
function playerOf(row: TournamentRow, key: string): string | undefined {
  return key ? Object.keys(row.keys).find(id => row.keys[id] === key) : undefined;
}

/** What a stored list shows as: its text, a paper one, or nothing when its cards are gone. */
function shown(list: ListRow | undefined): OpenList | null {
  if (list?.deck_mode === 'paper') {
    return { mode: 'paper', deck: '' };
  }
  return list?.deck.trim() ? { mode: 'digital', deck: list.deck } : null;
}

const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 1200 });

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.user && !rateLimiter.allows(rateLimitAddress(context.request))) {
    return jsonError('Too many requests from here. Try again shortly.', 429);
  }
  const { row, db } = access;
  if (!listsPublic(row)) {
    return jsonError(msg('This event’s lists aren’t open'), 404);
  }
  const key = new URL(context.request.url).searchParams.get('player');
  const { results } = await db
    .prepare('SELECT pop_id, first_name, last_name, deck, deck_mode FROM decklists WHERE code = ?')
    .bind(row.code)
    .all<ListRow>();
  const owner = decklistMatcher(row.tournament, isSanctioned(row));
  const ownerOf = (list: ListRow) => {
    const id = owner({ popId: list.pop_id, firstName: list.first_name, lastName: list.last_name });
    return id === undefined || decklistOpenFor(row, id) ? undefined : id;
  };
  if (key === null) {
    return jsonResponse({ players: readable(row, results, ownerOf) }, { cacheControl: CACHE, cors: false });
  }
  const id = playerOf(row, key);
  if (id === undefined) {
    return jsonError(msg('No such player'), 404);
  }
  const list = results.find(candidate => ownerOf(candidate) === id);
  return jsonResponse({ list: shown(list) }, { cacheControl: CACHE, cors: false });
}

/** The public keys of the players on the event whose list reads as a pasted one. */
function readable(row: TournamentRow, lists: readonly ListRow[], ownerOf: (list: ListRow) => string | undefined) {
  return lists.flatMap(list => {
    const id = shown(list)?.mode === 'digital' ? ownerOf(list) : undefined;
    const key = id === undefined ? undefined : row.keys[id];
    return key === undefined ? [] : [key];
  });
}
