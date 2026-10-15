/**
 * PUT /api/tournaments/:code/decks — staff set the archetype a player is on
 * ({ playerId, archetype }, a null archetype clearing it). It feeds the deck
 * column and the event's deck breakdown, shown as the visibility setting allows.
 */

import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { changeEvent, openForStaff } from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { archetypeLabel, withDeck } from '../../../lib/tournaments/decks.js';
import { changesNothing } from '../../../lib/tournaments/store.js';

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const value = (await readJsonObject(context.request, 1024)) ?? {};
  const label = archetypeLabel(value.archetype);
  const playerId = typeof value.playerId === 'string' ? value.playerId : '';
  if (label === undefined || !access.row.tournament.players.some(player => player.id === playerId)) {
    return jsonError('Not a deck change', 400);
  }
  const outcome = await changeEvent(access, row =>
    changesNothing(row, row.decks[playerId] ?? null, label) ? {} : { decks: withDeck(row.decks, playerId, label) }
  );
  return answerStaff(context, access, outcome);
}
