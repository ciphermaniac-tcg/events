/**
 * POST /api/auth/clerk-webhook — Clerk's webhook (lib/auth/clerkWebhook.ts).
 * Only a delivery Clerk signed with the webhook's secret is read. Anything
 * short of applying it answers other than 2xx, so Svix sends it again: a
 * missing secret or database (503), a failed write (500). A delivery not
 * signed by Clerk is refused (401) and read no further.
 */

import { jsonError } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
import { applyClerkEvent, signedByClerk } from '../../lib/auth/clerkWebhook.js';

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  const secret = env.CLERK_WEBHOOK_SECRET;
  if (!db || !secret) {
    return jsonError('Webhook is not available', 503);
  }
  const delivery = {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signatures: request.headers.get('svix-signature'),
    body: await request.text()
  };
  if (!(await signedByClerk(secret, delivery, Math.floor(Date.now() / 1000)))) {
    return jsonError('Not signed by Clerk', 401);
  }
  try {
    await applyClerkEvent(db, delivery.body);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Clerk webhook not applied; Svix will send it again', error instanceof Error ? error.message : error);
    return jsonError('Not applied', 500);
  }
}
