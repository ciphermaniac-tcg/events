/**
 * Publishing an event's public view to R2 after every change (see
 * PublishedView in shared/tournament/view.ts). A failed publish never fails
 * the change: the stale copy is taken down, so the page falls back to the API
 * until the next change publishes.
 *
 * Two changes can publish out of order, the older landing last. So each copy
 * carries its version, and a publish replaces only an older copy, and only
 * the copy it looked at: R2 refuses the write if another landed in between,
 * and the publish looks again. The copy up only ever moves forward, a burst
 * of writes puts up what it can skip, and nothing asks the database. Within
 * one isolate a burst goes further: an event publishes one copy at a time,
 * and only the newest row waiting is built and put up next (see publishView).
 * A later change can replace a drain stuck for 20 seconds; conditional
 * writes still protect newer copies when the old operation settles.
 *
 * A publish can also land after the event was deleted. Deleting takes the
 * copy down after the row, so a publish that lands on a copy still up is
 * taken down with it; one that finds no copy up asks the database whether
 * the event is still there.
 */

import { type PublishedView, publishedViewKey } from '../../../shared/tournament/view.js';
import { afterAnswer, type Context } from '../auth/env.js';
import { loadVersion, type TournamentRow } from './store.js';
import type { D1Like, PublishBucket, PublishedObject } from '../types.js';
import { publicViewOf } from './access.js';

/** Short: pairings go stale fast, and a poll that finds the edge copy is still a free read. */
const PUBLISHED_CACHE_CONTROL = 'public, max-age=5';

/**
 * Each refused write means another publish landed first, and a landing only
 * ever moves the copy forward, so the tries run out only when a publish is
 * behind that many others at once: a safety stop, not a limit a round's end
 * reaches.
 */
const MAX_TRIES = 32;

/** Let a later change bypass a stuck R2 head/put after 20 seconds. */
const DRAIN_MAX_AGE_MS = 20_000;

interface PublishEnv {
  EVENTS_DATA?: PublishBucket;
  TOURNAMENT_DB?: D1Like;
}

/** The version a copy was published at; -1 for none, or one put up before copies carried it. */
function versionOf(object: PublishedObject | null): number {
  const version = Number(object?.customMetadata?.version);
  return Number.isInteger(version) ? version : -1;
}

/** Only the copy that was looked at, or only onto no copy at all. */
const unchangedSince = (held: PublishedObject | null) =>
  held ? { etagMatches: held.etag } : new Headers({ 'If-None-Match': '*' });

/** Whether the copy up is now `row`'s or newer. */
async function putOver(bucket: PublishBucket, row: TournamentRow, body: string): Promise<'up' | 'landed' | 'raced'> {
  const key = publishedViewKey(row.code);
  const held = await bucket.head(key);
  if (versionOf(held) >= row.version) {
    return 'up';
  }
  const put = await bucket.put(key, body, {
    httpMetadata: { contentType: 'application/json', cacheControl: PUBLISHED_CACHE_CONTROL },
    customMetadata: { version: String(row.version) },
    onlyIf: unchangedSince(held)
  });
  if (!put) {
    return 'raced';
  }
  return held ? 'up' : 'landed';
}

async function publishOnce(
  env: PublishEnv,
  bucket: PublishBucket,
  row: TournamentRow,
  cleanup: () => Promise<void>
): Promise<void> {
  const view: PublishedView = publicViewOf(row);
  const body = JSON.stringify(view);
  try {
    for (let tries = 0; tries < MAX_TRIES; tries += 1) {
      const outcome = await putOver(bucket, row, body);
      if (outcome === 'landed') {
        await takeDownIfGone(env, row.code, cleanup);
      }
      if (outcome !== 'raced') {
        return;
      }
    }
    console.error('Publishing the event view gave up behind other publishes', row.code);
  } catch (error) {
    console.error('Publishing the event view failed', error);
  }
  // A copy left up could stay stale; without one, the page asks the API.
  await cleanup();
}

interface Pending {
  env: PublishEnv;
  row: TournamentRow;
}

/** One event's publishing in this isolate: `offer` a row to it, and `done` is when all it took is up. */
interface Drain {
  offer: (pending: Pending) => Pending;
  startedAt: number;
  cleaning: boolean;
  done: Promise<void>;
}

/** Publishes `first`, then the newest row offered meanwhile, until none waits; then `finish`. */
function drain(bucket: PublishBucket, first: Pending, isCurrent: () => boolean, finish: () => void): Drain {
  let newest = first;
  let waiting: Pending | null = first;
  const take = () => {
    const next = waiting;
    waiting = null;
    return next;
  };
  const cleanup = async () => {
    if (!isCurrent()) {
      return;
    }
    // R2 has no conditional delete. Do not permit takeover during an issued delete.
    state.cleaning = true;
    try {
      await unpublishView(bucket, first.row.code);
    } finally {
      state.cleaning = false;
    }
  };
  // Let go in the same step that finds nothing waiting, so no row is offered to a drain that has stopped.
  const run = async () => {
    try {
      for (let next = take(); next; next = isCurrent() ? take() : null) {
        await publishOnce(next.env, bucket, next.row, cleanup);
      }
    } finally {
      finish();
    }
  };
  const offer = (pending: Pending) => {
    if (pending.row.version > newest.row.version) {
      newest = pending;
      waiting = pending;
    }
    return newest;
  };
  const state: Drain = { offer, startedAt: Date.now(), cleaning: false, done: Promise.resolve() };
  state.done = run();
  return state;
}

/** Each bucket's drains, by event code. */
const drains = new WeakMap<PublishBucket, Map<string, Drain>>();

/**
 * Publishes `row`. While this isolate is already publishing the event, the
 * row waits its turn instead, and a newer row waiting takes its place: a
 * burst of changes builds and puts up the newest it has, not every one.
 * An aged drain is replaced unless its unconditional cleanup delete is in
 * flight; retired drains cannot clean up or remove the replacement.
 * Resolves once the copy up is this row's or newer, or the publish failed.
 */
export function publishView(env: PublishEnv, row: TournamentRow): Promise<void> {
  const bucket = env.EVENTS_DATA;
  if (!bucket) {
    return Promise.resolve();
  }
  const byCode = drains.get(bucket) ?? new Map<string, Drain>();
  drains.set(bucket, byCode);
  const running = byCode.get(row.code);
  const newest = running?.offer({ env, row }) ?? { env, row };
  if (running && (running.cleaning || Date.now() - running.startedAt < DRAIN_MAX_AGE_MS)) {
    return running.done;
  }
  const isCurrent = () => byCode.get(row.code) === started;
  const started = drain(bucket, newest, isCurrent, () => {
    if (isCurrent()) {
      byCode.delete(row.code);
    }
  });
  byCode.set(row.code, started);
  return started.done;
}

/** A copy put where there was none may belong to an event deleted meanwhile. */
async function takeDownIfGone(env: PublishEnv, code: string, cleanup: () => Promise<void>): Promise<void> {
  if (env.TOURNAMENT_DB && (await loadVersion(env.TOURNAMENT_DB, code)) === null) {
    await cleanup();
  }
}

/**
 * Publishes once the answer has gone, where the runtime can keep the function
 * alive for it: whoever made the change does not wait on R2. The pages that
 * read the copy poll it seconds apart.
 */
export function publishAfter(context: Pick<Context, 'env' | 'waitUntil'>, row: TournamentRow): Promise<void> {
  return afterAnswer(context, publishView(context.env, row));
}

export async function unpublishView(bucket: PublishBucket | undefined, code: string): Promise<void> {
  await bucket?.delete(publishedViewKey(code)).catch((error: unknown) => console.error('Unpublish failed', error));
}
