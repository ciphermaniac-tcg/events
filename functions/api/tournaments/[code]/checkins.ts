/**
 * PUT /api/tournaments/:code/checkins — staff tick or clear one check for a
 * player before round 1 ({ playerId, mark, on }; see
 * shared/tournament/checkins.ts). A player is anyone on the event's list, or
 * at a TOM event someone who registered on the site and is not in TOM's file
 * yet, so the ID is any Player ID the event knows of.
 */

import { CHECK_MARKS, type CheckMark, withMark } from '../../../../shared/tournament/checkins.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import type { StaffAccess } from '../../../lib/tournaments/access.js';
import { staffChange } from '../../../lib/tournaments/answers.js';
import { changesNothing } from '../../../lib/tournaments/store.js';

interface Check {
  playerId: string;
  mark: CheckMark;
  on: boolean;
}

function readCheck(value: Record<string, unknown>): Check | null {
  const { playerId, mark, on } = value;
  const known = typeof mark === 'string' && (CHECK_MARKS as readonly string[]).includes(mark);
  return typeof playerId === 'string' && playerId && known && typeof on === 'boolean'
    ? { playerId, mark: mark as CheckMark, on }
    : null;
}

/** Whether the event knows the player: on its list, or registered on the site under that Player ID. */
async function knows(access: StaffAccess, playerId: string): Promise<boolean> {
  if (access.row.tournament.players.some(player => player.id === playerId)) {
    return true;
  }
  const listed = await access.db
    .prepare('SELECT 1 AS yes FROM decklists WHERE code = ? AND user_id = ?')
    .bind(access.row.code, `pop:${playerId}`)
    .first<{ yes: number }>();
  return listed !== null;
}

export function onRequestPut(context: Context<'code'>): Promise<Response> {
  return staffChange(context, async access => {
    const check = readCheck((await readJsonObject(context.request, 1024)) ?? {});
    if (!check || !(await knows(access, check.playerId))) {
      return jsonError('Not a check-in', 400);
    }
    return row => {
      const next = withMark(row.checkins, check.playerId, check.mark, check.on);
      return changesNothing(row, row.checkins, next) ? {} : { checkins: next };
    };
  });
}
