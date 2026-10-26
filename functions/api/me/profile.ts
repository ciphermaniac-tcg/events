import { readProfileLinks } from '../../../shared/accounts/profile.js';
import { profilePreferences, saveProfileLinks } from '../../lib/accounts/profile.js';
import { readJsonObject } from '../../lib/api/body.js';
import { jsonError } from '../../lib/api/responses.js';
import { privateJson } from '../../lib/tournaments/access.js';
import type { Context } from '../../lib/auth/env.js';
import { currentUser, signedIn } from '../../lib/auth/session.js';
import type { D1Like } from '../../lib/types.js';

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  const user = db ? await currentUser(db, request) : null;
  return db && user ? privateJson(await profilePreferences(db, user.id)) : jsonError('Sign in first', 401);
}

async function save(db: D1Like, userId: string, body: Record<string, unknown>): Promise<Response> {
  if (Object.keys(body).length !== 1 || !('links' in body)) {
    return jsonError('Not a valid change', 400);
  }
  const links = readProfileLinks(body.links);
  if (!links) {
    return jsonError('Not valid profile links', 400);
  }
  await saveProfileLinks(db, userId, links);
  return privateJson({ links });
}

export async function onRequestPut({ request, env }: Context): Promise<Response> {
  const opened = await signedIn({ request, env });
  if (opened instanceof Response) {
    return opened;
  }
  const { db, user } = opened;
  const body = await readJsonObject(request, 4096);
  return body ? save(db, user.id, body) : jsonError('Not a valid change', 400);
}
