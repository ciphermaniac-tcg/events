/** GET /api/tournaments/:code/manage — staff view; unchanged version polls return 204 without settling reports. */

import { noContent } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, openForStaffRead, pollOf, privateJson } from '../../../lib/tournaments/access.js';
import { loadHead } from '../../../lib/tournaments/store.js';

/** Whether the asker is the event's staff and their copy is still current; anything else takes the full answer. */
async function unchanged(context: Context<'code'>): Promise<boolean> {
  const poll = pollOf(context);
  const head = poll && (await loadHead(poll.db, poll.code, context.request));
  return poll !== null && head !== null && head.staff && head.version === poll.since;
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  if (await unchanged(context)) {
    return noContent();
  }
  const access = await openForStaffRead(context);
  return access instanceof Response ? access : privateJson(manageView(access));
}
