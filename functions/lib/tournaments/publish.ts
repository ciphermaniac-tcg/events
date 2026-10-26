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
export const PUBLISHED_CACHE_CONTROL = 'public, max-age=5';

/**
 * Each refused write means another publish landed first, and a landing only
 * ever moves the copy forward, so the tries run out only when a publish is
 * behind that many others at once: a safety stop, not a limit a round's end
 * reaches.
 */
const MAX_TRIES = 32;

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

async function publishOnce(env: PublishEnv, bucket: PublishBucket, row: TournamentRow): Promise<void> {
  const view: PublishedView = publicViewOf(row);
  const body = JSON.stringify(view);
  try {
    for (let tries = 0; tries < MAX_TRIES; tries += 1) {
      const outcome = await putOver(bucket, row, body);
      if (outcome === 'landed') {
        await takeDownIfGone(env, row.code);
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
  await unpublishView(bucket, row.code);
}

interface Pending {
  env: PublishEnv;
  row: TournamentRow;
}

/** One event's publishing in this isolate: `offer` a row to it, and `done` is when all it took is up. */
interface Drain {
  offer: (pending: Pending) => void;
  done: Promise<void>;
}

/** Publishes `first`, then the newest row offered meanwhile, until none waits; then `finish`. */
function drain(bucket: PublishBucket, first: Pending, finish: () => void): Drain {
  let newest = first.row.version;
  let waiting: Pending | null = first;
  const take = () => {
    const next = waiting;
    waiting = null;
    return next;
  };
  // Let go in the same step that finds nothing waiting, so no row is offered to a drain that has stopped.
  const run = async () => {
    try {
      for (let next = take(); next; next = take()) {
        await publishOnce(next.env, bucket, next.row);
      }
    } finally {
      finish();
    }
  };
  const offer = (pending: Pending) => {
    if (pending.row.version > newest) {
      newest = pending.row.version;
      waiting = pending;
    }
  };
  return { offer, done: run() };
}

/** Each bucket's drains, by event code. */
const drains = new WeakMap<PublishBucket, Map<string, Drain>>();

/**
 * Publishes `row`. While this isolate is already publishing the event, the
 * row waits its turn instead, and a newer row waiting takes its place: a
 * burst of changes builds and puts up the newest it has, not every one.
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
  if (running) {
    running.offer({ env, row });
    return running.done;
  }
  const started = drain(bucket, { env, row }, () => byCode.delete(row.code));
  byCode.set(row.code, started);
  return started.done;
}

/** A copy put where there was none may belong to an event deleted meanwhile. */
async function takeDownIfGone(env: PublishEnv, code: string): Promise<void> {
  if (env.TOURNAMENT_DB && (await loadVersion(env.TOURNAMENT_DB, code)) === null) {
    await unpublishView(env.EVENTS_DATA, code);
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
