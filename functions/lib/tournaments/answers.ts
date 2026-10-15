/**
 * How the routes that change an event finish: the public view is published
 * (see publish.ts), and staff get the console's new copy of the event.
 */

import { jsonError } from '../api/responses.js';
import type { Context } from '../auth/env.js';
import { manageView, privateJson, type StaffAccess } from './access.js';
import { publishAfter } from './publish.js';
import type { Mutation } from './store.js';

/** What a staff change answers with: why it was refused, or the console's new copy of the event. */
export async function answerStaff(context: Context<'code'>, access: StaffAccess, outcome: Mutation): Promise<Response> {
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishAfter(context, outcome.row);
  if (outcome.refusal) {
    return jsonError(outcome.refusal, 400);
  }
  return privateJson(manageView({ ...access, row: outcome.row }));
}
