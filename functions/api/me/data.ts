/**
 * GET /api/me/data — what the site keeps on the signed-in account, as a
 * Markdown file to download (functions/lib/accounts/dataExport.ts): the
 * parts named in ?parts= as a comma list, or all of them. With ?holds, what
 * would hold up a wipe or a deletion now (see DataHolds), so the page says so
 * before anyone asks for one.
 * POST /api/me/data — wipes the parts asked for ({ parts }, see
 * shared/accounts/myData.ts) and answers the account as it then stands; 409
 * with the running events when organizer history must wait for them to end.
 */

import { readExportParts, readWipeParts } from '../../../shared/accounts/myData.js';
import { exportMarkdown } from '../../lib/accounts/dataExport.js';
import { dataHolds, wipeParts } from '../../lib/accounts/wipe.js';
import { readJsonObject } from '../../lib/api/body.js';
import { jsonError, jsonResponse, PRIVATE } from '../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../lib/auth/env.js';
import { currentAccount, signedIn } from '../../lib/auth/session.js';

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const url = new URL(request.url);
  if (url.searchParams.has('holds')) {
    const user = await currentAccount(db, request);
    return user ? jsonResponse(await dataHolds(db, user), PRIVATE) : jsonError('Sign in first', 401);
  }
  const parts = readExportParts(url.searchParams.get('parts'));
  if (!parts) {
    return jsonError('Choose what to export', 400);
  }
  const user = await currentAccount(db, request);
  const markdown = user && (await exportMarkdown(db, user.id, { parts, origin: url.origin }));
  if (!user || !markdown) {
    return jsonError('Sign in first', 401);
  }
  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="ciphermaniac-${user.handle}.md"`,
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const opened = await signedIn({ request, env }, currentAccount);
  if (opened instanceof Response) {
    return opened;
  }
  const { db, user } = opened;
  const parts = readWipeParts((await readJsonObject(request, 256))?.parts);
  if (!parts) {
    return jsonError('Choose what to wipe', 400);
  }
  const refusal = await wipeParts(db, user, parts);
  if (refusal) {
    return jsonResponse(refusal, { ...PRIVATE, status: 409 });
  }
  const after = await currentAccount(db, request);
  return after ? jsonResponse({ user: after }, PRIVATE) : jsonError('Sign in first', 401);
}
