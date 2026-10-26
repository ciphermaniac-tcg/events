/** What every tournament and account function needs from its environment. */

import type { D1Like, ProofBucket, PublishBucket } from '../types.js';
import type { AuthEnv } from './oauth.js';

export interface TournamentEnv extends AuthEnv {
  TOURNAMENT_DB?: D1Like;
  /** This site's data bucket, served at events-data.ciphermaniac.com: event views and the stores index are published to it. */
  EVENTS_DATA?: PublishBucket;
  /** What the scheduled sweep that ends idle events sends as its bearer token (functions/api/tournaments/idle.ts). */
  IDLE_SWEEP_TOKEN?: string;
  /** The private bucket Applications' proof files were kept in; only deleted from now (functions/lib/auth/rejection.ts). */
  PROOFS?: ProofBucket;
}

export interface Context<Params extends string = never> {
  request: Request;
  env: TournamentEnv;
  params: { [key in Params]: string | string[] };
  /** Keeps the function alive for work that outlasts the answer; tests call the handlers without it. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** Leaves `work` running past the answer where the runtime keeps the function alive for it; else waits on it. */
export async function afterAnswer(context: Pick<Context, 'waitUntil'>, work: Promise<unknown>): Promise<void> {
  if (context.waitUntil) {
    context.waitUntil(work);
    return;
  }
  await work;
}

/** A route parameter as one string; Pages hands catch-alls over as arrays. */
export function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join('/') : (value ?? '');
}

/**
 * Whether a state-changing request came from this site. The session cookie is
 * SameSite=Lax, which already keeps it off another site's POST; checking the
 * Origin as well covers browsers that treat Lax loosely.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return origin === null
    ? request.method === 'GET' || request.method === 'HEAD'
    : origin === new URL(request.url).origin;
}
