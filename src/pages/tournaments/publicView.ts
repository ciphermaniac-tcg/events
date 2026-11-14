/**
 * The public event page's copy of the event: polled, kept for a load without
 * a signal, and told who the viewer is. See createView.
 */

import { createEffect, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import type { PublishedView, TournamentView } from '../../../shared/tournament/view';
import { ApiError, fetchPublished, fetchView } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { onChange } from '../../lib/tournament/changes';
import { shared } from '../../lib/tournament/share';
import {
  askOnReturn,
  createViewPoll,
  firstView,
  lookOnReturn,
  schedulePolls,
  seesMoreThanPublished,
  type ViewSource
} from '../../lib/tournament/viewPoll';
import { EMPTY_LIVE_DATA, type LiveData, liveFailure } from '../../lib/tournament/liveData';
import { keepEventCopy, readEventCopy } from '../../lib/tournament/eventCopies';

/** No event has this code: asking again will not find one. */
export const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

export const sameViewer = (a: TournamentView['viewer'], b: TournamentView['viewer']) =>
  a.role === b.role && a.me === b.me && a.via === b.via && a.signedIn === b.signedIn;

/**
 * The event's first load. With no signal (or no answer the page can use), the
 * copy this device last saw, shown as behind (its clocks stop) until a look
 * finds the event.
 */
function load(
  c: string,
  api: () => Promise<TournamentView>,
  live: { checked: () => void; failed: (error: unknown) => void; kept: (data: LiveData) => void }
): Promise<TournamentView> {
  return firstView({ published: () => fetchPublished(c), api })
    .then(next => {
      live.checked();
      return next;
    })
    .catch((error: unknown) => {
      const kept = missing(error) ? null : readEventCopy(c, Date.now());
      if (kept) {
        live.kept({ checkedAt: kept.savedAt, failure: liveFailure(error), kept: true });
        return kept.view;
      }
      live.failed(error);
      throw error;
    });
}

/**
 * Keeps the copy current while the page is open: polls every `every` ms, looks
 * again when the tab is shown or another tab of this browser changes the
 * event, and asks who the viewer is on return. Returns the retry.
 */
function follow(
  code: () => string,
  source: Omit<ViewSource, 'announced' | 'published' | 'now'>,
  on: { every: number; ask: () => void; shown: () => void }
): () => void {
  let announced = 0;
  const poll = createViewPoll({
    ...source,
    announced: () => announced,
    published: () => fetchPublished(code()),
    now: Date.now
  });
  const polls = schedulePolls(poll, () => document.hidden, on.every);
  const forget = lookOnReturn(polls);
  const forgetViewer = askOnReturn(on.ask, Date.now);
  const shown = () => {
    if (!document.hidden) {
      on.shown();
    }
  };
  document.addEventListener('visibilitychange', shown);
  const unsubscribe = onChange(code(), version => {
    if (version > (source.current()?.version ?? 0)) {
      announced = Math.max(announced, version);
      polls.soon();
    }
  });
  onCleanup(() => {
    polls.stop();
    unsubscribe();
    forget();
    forgetViewer();
    document.removeEventListener('visibilitychange', shown);
  });
  return () => {
    poll.retry();
    polls.soon();
  };
}

/**
 * The event, polled while the tab is visible (see lib/tournament/viewPoll.ts),
 * every `every` ms; a poll that finds nothing new costs one tiny request. It
 * also looks the moment the tab is shown again, and when the console in
 * another tab of this browser changes the event. `decks` is whether the page
 * shows decks, the only thing staff see that the published file does not.
 */
export function createView(code: () => string, signedIn: () => boolean, options: { every: number; decks: boolean }) {
  // Moved on by every read of who the viewer is, and by their own undo (see fromApi).
  let generation = 0;
  const [freshness, setFreshness] = createSignal<LiveData>(EMPTY_LIVE_DATA);
  const checked = () => setFreshness({ checkedAt: Date.now(), failure: null });
  const failed = (error: unknown) => setFreshness(data => ({ ...data, failure: liveFailure(error) }));
  let retry: () => void = () => void reload();
  /**
   * The API's copy, or null when nothing is newer than `since`. What it says
   * of the viewer counts only if nothing since it was asked knows better: a
   * later read of who they are, or their own undo. Its event counts either way.
   */
  async function fromApi(c: string, since?: number): Promise<TournamentView | null> {
    const asked = generation;
    const next = await fetchView(c, since);
    const shown = latestValue(view);
    return next && shown && asked !== generation ? { ...next, viewer: shown.viewer } : next;
  }
  /** Asks the API who the viewer is: the answer outdates every read asked before it. */
  function askWho(c: string): Promise<TournamentView> {
    generation += 1;
    return fromApi(c).then(v => v as TournamentView);
  }
  const [view, { mutate, refetch }] = createResource(code, c =>
    load(c, () => fromApi(c).then(v => v as TournamentView), { checked, failed, kept: setFreshness })
  );
  // Each copy taken is kept for the next load without a signal; an older one never goes back over a newer.
  // Written once a version, not on every look that finds nothing new.
  let keptVersion = '';
  createEffect(() => {
    const shown = latestValue(view);
    const version = shown ? `${shown.code}:${shown.version}:${shown.viewer.role}` : '';
    if (shown && freshness().failure === null && version !== keptVersion) {
      keptVersion = version;
      keepEventCopy(shown, Date.now());
    }
  });
  /**
   * Takes a copy no older than the one shown, of the same event: answers can
   * land out of order. An older one still says who the viewer is, which the
   * copy shown may not know yet.
   */
  function accept(next: TournamentView) {
    const current = latestValue(view);
    if (!current || (current.code === next.code && next.version >= current.version)) {
      mutate(shared(current, next));
    } else if (current.code === next.code && !sameViewer(current.viewer, next.viewer)) {
      mutate({ ...current, viewer: next.viewer });
    }
  }
  // The published file knows nobody. A signed-in viewer's copy comes from the API: staff see
  // decks before the public does, and an account's Player ID marks its player.
  let asked = '';
  createEffect(() => {
    const shown = latestValue(view);
    // Asked once an event: an answer that still knows nobody is not asked for again.
    if (signedIn() && shown && !shown.viewer.signedIn && asked !== shown.code) {
      asked = shown.code;
      void askWho(shown.code)
        .then(accept)
        .catch(() => undefined);
    }
  });
  /** Loads the event again after its first load failed; whether it is there now. */
  async function reload(): Promise<boolean> {
    if (!view.error) {
      return true;
    }
    if (missing(view.error)) {
      return false;
    }
    try {
      return (await refetch()) != null;
    } catch {
      return false;
    }
  }
  /**
   * Asks the API who the viewer is: polls only ask when the event changes, and
   * who the viewer is can change without it (their own action, another of
   * their devices, staff).
   */
  const whoAmI = () =>
    void askWho(code())
      .then(accept)
      .catch(() => undefined);
  onMount(() => {
    retry = follow(
      code,
      {
        current: () => latestValue(view),
        ownCopy: shown => options.decks && seesMoreThanPublished(shown),
        reload,
        api: since => fromApi(code(), since),
        apply: accept,
        checked,
        failed
      },
      {
        every: options.every,
        // Back in view, a signed-in viewer catches up on a Claim made or released elsewhere.
        ask: () => signedIn() && whoAmI(),
        // Back in view, the page waits for the look it starts before calling itself behind.
        shown: () => setFreshness(data => ({ ...data, shownAt: Date.now() }))
      }
    );
  });
  /** Takes a fresher copy handed over by an action, such as a player's report. */
  function take(published: PublishedView) {
    const current = latestValue(view);
    if (current) {
      accept({ ...published, viewer: current.viewer });
    }
  }
  /** The account is no longer a player here, as its own undo just made it: no need to ask the API. */
  function unlinked() {
    generation += 1;
    const current = latestValue(view);
    if (current) {
      const { role, signedIn } = current.viewer;
      mutate({ ...current, viewer: { role, me: null, via: null, signedIn } });
    }
  }
  return { view, take, whoAmI, unlinked, freshness, retry: () => retry() };
}
