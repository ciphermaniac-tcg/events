import { playerSearch } from '../../../../shared/tournament/returningPlayers.js';
import type { Context } from '../../../lib/auth/env.js';
import { openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { returningPlayers } from '../../../lib/tournaments/returningPlayers.js';

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const query = playerSearch(new URL(context.request.url).searchParams.get('q') ?? '');
  return privateJson({ players: query ? await returningPlayers(access, query) : [] });
}
