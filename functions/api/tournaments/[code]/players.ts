import { playerSearch } from '../../../../shared/tournament/returningPlayers.js';
import type { Context } from '../../../lib/auth/env.js';
import { keyHeldTo } from '../../../lib/d1.js';
import { openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { returningPlayers, returningPlayersQuery } from '../../../lib/tournaments/returningPlayers.js';

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const query = playerSearch(new URL(context.request.url).searchParams.get('q') ?? '');
  const access = await openForStaff(
    context,
    query ? (db, code, guard, { hash }) => [returningPlayersQuery(db, keyHeldTo(code, guard), hash, query)] : undefined
  );
  if (access instanceof Response) {
    return access;
  }
  return privateJson({ players: query ? returningPlayers(access.along[0]) : [] });
}
