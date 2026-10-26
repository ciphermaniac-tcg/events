/**
 * PUT /api/tournaments/:code/requests — staff answer a player's request by
 * its ID ({ id, status, localTime }; see shared/tournament/requests.ts):
 * confirm or decline a drop, or mark a contact done. The answer records who
 * on staff gave it and when, and lands only on the request staff saw: one
 * cancelled or answered since is refused. Confirming a drop at a Swiss event
 * drops the player in the same write; at a TOM event staff drop them in
 * TOM. Players file and cancel their requests through /report.
 */

import { isAnswer } from '../../../../shared/tournament/requests.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { staffChange } from '../../../lib/tournaments/answers.js';
import { staffAnswerChanges } from '../../../lib/tournaments/requests.js';

export function onRequestPut(context: Context<'code'>): Promise<Response> {
  return staffChange(context, async access => {
    const { id, status, localTime } = (await readJsonObject(context.request, 512)) ?? {};
    if (typeof id !== 'string' || !isAnswer(status)) {
      return jsonError('Not an answer to a request', 400);
    }
    const by = access.user?.name ?? '';
    const answer = { id, status, by, localTime };
    return row => staffAnswerChanges(row, { ...answer, at: Date.now() });
  });
}
