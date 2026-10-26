/**
 * How the routes that change an event finish: the public view is published
 * (see publish.ts) when the change wrote a version, and staff get the
 * console's new copy of the event.
 */

import { jsonError } from '../api/responses.js';
import type { Context } from '../auth/env.js';
import { changeEvent, manageView, openForStaff, privateJson, type StaffAccess } from './access.js';
import { publishAfter } from './publish.js';
import type { Change, Mutation } from './store.js';

/** What a staff change answers with: why it was refused, or the console's new copy of the event. */
export async function answerStaff(
  context: Context<'code'>,
  access: StaffAccess,
  outcome: Mutation,
  extra: Record<string, unknown> = {}
): Promise<Response> {
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  // A change that wrote nothing has nothing new to publish.
  if (outcome.row.version !== access.row.version) {
    await publishAfter(context, outcome.row);
  }
  if (outcome.refusal) {
    return jsonError(outcome.refusal, 400);
  }
  return privateJson({ ...manageView({ row: outcome.row, role: outcome.role ?? access.role }), ...extra });
}

/**
 * A staff route's change from start to answer: the event opened for its
 * staff, the change `plan` reads from the request and the event, or the
 * answer that turns the request away, and the change made and answered.
 */
export async function staffChange(
  context: Context<'code'>,
  plan: (access: StaffAccess) => Promise<Change | Response>
): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const change = await plan(access);
  return change instanceof Response ? change : answerStaff(context, access, await changeEvent(access, change));
}
