/**
 * POST /api/me/setup — the one time an account made before the age check
 * asked for them is offered its username and name ({ handle?, firstName?,
 * lastName? }, each optional). An empty body is "Not now". Either way the
 * offer is spent; a username someone else holds (409) or past the day's
 * changes (429) leaves it open to try again.
 */

import { displayName } from '../../../shared/accounts/handle.js';
import { RENAME_REFUSED, renameAccount } from '../../lib/accounts/handles.js';
import { readSetup } from '../../lib/accounts/setup.js';
import { readJsonObject } from '../../lib/api/body.js';
import { jsonError, jsonResponse, PRIVATE } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
import { type AccountSetup, currentAccount, signedIn, type User } from '../../lib/auth/session.js';
import type { D1Like } from '../../lib/types.js';

/** Saves the names given, keeping any left out, and spends the offer. */
async function saveNames(db: D1Like, user: User, setup: AccountSetup): Promise<User> {
  await db
    .prepare(
      'UPDATE users SET first_name = COALESCE(?2, first_name), last_name = COALESCE(?3, last_name), ' +
        'setup_offered_at = ?4 WHERE id = ?1'
    )
    .bind(user.id, setup.firstName, setup.lastName, Date.now())
    .run();
  return { ...user, firstName: setup.firstName ?? user.firstName, lastName: setup.lastName ?? user.lastName };
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const opened = await signedIn({ request, env }, currentAccount);
  if (opened instanceof Response) {
    return opened;
  }
  const { db, user } = opened;
  const setup = readSetup((await readJsonObject(request, 512)) ?? {});
  if (typeof setup === 'string') {
    return jsonError(setup, 400);
  }
  const refused = setup.handle ? await renameAccount(db, user, setup.handle) : null;
  if (refused) {
    return jsonError(RENAME_REFUSED[refused].error, RENAME_REFUSED[refused].status);
  }
  const saved = await saveNames(db, { ...user, handle: setup.handle ?? user.handle }, setup);
  return jsonResponse({ user: { ...saved, name: displayName(saved) } }, PRIVATE);
}
