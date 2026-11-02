/**
 * GET /api/tournaments/:code/lists?player=<public key> — one player's list,
 * for anyone, once the organizer has opened the event's lists and round 1 is
 * paired (see listsPublic). The player is named by the key the public view
 * knows them by, never their Player ID. Answers { list }: the pasted text,
 * the word that it was handed in on paper, or null when the player sent none
 * (or the event ended and a minor's cards went with it, see store.ts).
 */

import { decklistMatcher } from '../../../../shared/tournament/identify.js';
import { isSanctioned, listsPublic, type OpenList } from '../../../../shared/tournament/view.js';
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

/** Locked lists change only as the event ends, so a minute's copy is fine anywhere. */
const CACHE = 'public, max-age=60';

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

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  const { row, db } = access;
  if (!listsPublic(row)) {
    return jsonError(msg('This event’s lists aren’t open'), 404);
  }
  const id = playerOf(row, new URL(context.request.url).searchParams.get('player') ?? '');
  if (id === undefined) {
    return jsonError(msg('No such player'), 404);
  }
  const { results } = await db
    .prepare('SELECT pop_id, first_name, last_name, deck, deck_mode FROM decklists WHERE code = ?')
    .bind(row.code)
    .all<ListRow>();
  const owner = decklistMatcher(row.tournament, isSanctioned(row));
  const list = results.find(
    candidate =>
      owner({ popId: candidate.pop_id, firstName: candidate.first_name, lastName: candidate.last_name }) === id
  );
  return jsonResponse({ list: shown(list) }, { cacheControl: CACHE, cors: false });
}
