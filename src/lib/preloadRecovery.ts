/**
 * Recovery for lazy-route chunks that a deploy has removed.
 *
 * Every route below the home page is code-split, so a tab left open across a
 * deploy still holds the previous shell — and that shell points at
 * content-hashed chunks the server no longer has. The next navigation then
 * fails inside Vite's preload helper ("Unable to preload CSS for
 * /assets/<Page>-<hash>.css") and the route never renders. Pages makes the
 * failure quieter and stranger than a plain 404: with no top-level 404.html it
 * answers a missing asset with the HTML shell, so the stylesheet request comes
 * back 200 with the wrong type.
 *
 * Vite dispatches a cancelable `vite:preloadError` before throwing, which is
 * the hook: reload once and the tab picks up the current shell. Vite fires it
 * for a dropped connection too, where a reload would trade the page for the
 * browser's offline screen, so the reload waits on the site answering.
 * @module src/lib/preloadRecovery
 */

import { createSignal } from 'solid-js';

/** How long a reload suppresses the next one. */
export const RELOAD_GUARD_MS = 30_000;

/** How long the site may take to answer before a failed chunk is put down to the connection. */
const PROBE_TIMEOUT_MS = 5_000;

const RELOAD_GUARD_KEY = 'cm:preload-reload';

const [recovering, setRecovering] = createSignal(false);

/** Chunks being fetched ahead of need, whose failures are theirs to keep (see warmChunks). */
let warming = 0;

/** A prevented import can still fail in its caller before the reload finishes. Reactive: it ends if the site is out of reach. */
export const isRecoveringPreload = recovering;

/**
 * Whether a preload failure should reload the page.
 *
 * One reload fixes a stale shell. A second one straight after means the asset
 * is genuinely gone — reloading again would just spin, so let the error throw
 * and surface instead.
 * @param lastReloadAt Epoch ms of the last recovery reload, or null if none.
 * @param now Current epoch ms.
 * @returns True when a reload is worth attempting.
 */
export function shouldReloadAfterPreloadError(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null || !Number.isFinite(lastReloadAt)) {
    return true;
  }
  return now - lastReloadAt >= RELOAD_GUARD_MS;
}

/** Session storage, or null where it is unavailable (private modes throw). */
function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Whether the site answers now. A chunk that failed while it does was a
 * deploy's; one that failed while it doesn't was the connection's, and a
 * reload would only land on the browser's offline page.
 */
export async function siteAnswers(): Promise<boolean> {
  try {
    const response = await fetch('/', { cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Reload once when a lazy chunk fails to preload and the site still answers.
 *
 * Call at startup. Without a listener Vite rethrows, which in practice means a
 * blank route for anyone whose tab predates the running deploy. Out of reach,
 * the failure is left to the boundary around the panel or page, which offers
 * to try again.
 */
export function installPreloadRecovery(): void {
  window.addEventListener('vite:preloadError', event => {
    const store = safeSessionStorage();
    const raw = store?.getItem(RELOAD_GUARD_KEY);
    if (
      warming > 0 ||
      !shouldReloadAfterPreloadError(raw === null || raw === undefined ? null : Number(raw), Date.now())
    ) {
      return;
    }
    event.preventDefault();
    setRecovering(true);
    void siteAnswers().then(answers => {
      if (!answers) {
        setRecovering(false);
        return;
      }
      store?.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      window.location.reload();
    });
  });
}

/**
 * A chunk's import for `lazy()`, failing when recovery took its error over.
 * Vite's helper then answers with nothing rather than throwing, and `lazy()`
 * would keep that nothing for good; as a failure it asks again next time,
 * which is what a retry needs. A loader's own `.then(m => ({ default: m.X }))`
 * never sees the nothing: the build wraps the whole loader, that included,
 * in the helper.
 */
export function retryable<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().then(module => (module as T | undefined) ?? Promise.reject(new TypeError('A chunk did not load')));
}

/**
 * Fetches chunks ahead of need once the browser is idle, so a panel opened
 * after the venue's Wi-Fi drops is already here. Their failures recover
 * nothing: reloading the page under someone at work for a chunk they haven't
 * asked for would cost more than the miss, which the panel's own boundary
 * offers to try again. A chunk asked for meanwhile shares that, for the beat
 * the warming takes.
 */
export function warmChunks(loads: readonly (() => Promise<unknown>)[]): void {
  const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1));
  idle(() => {
    warming += 1;
    void Promise.allSettled(loads.map(load => load())).finally(() => {
      warming -= 1;
    });
  });
}
