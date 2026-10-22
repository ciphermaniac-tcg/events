import { createEffect, ErrorBoundary, on, onMount, type ParentComponent, Show, Suspense } from 'solid-js';
import { useIsRouting, useLocation } from '@solidjs/router';
import { SiteFooter } from './components/SiteFooter';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';
import { SiteHead } from './components/SiteHead';
import { useScrollRestoration } from './lib/scrollRestore';
import { isRecoveringPreload } from './lib/preloadRecovery';
import { t } from './lib/i18n';
import { pageTitle } from './lib/title';

/**
 * Fallback while a lazy route chunk downloads on a cold load (page data never
 * suspends — pages read resources via lib/resource.ts and render their own
 * skeletons). Generic on purpose: it only shows for the beat before the
 * page's real skeleton takes over.
 */
function ChunkFallback() {
  return (
    <div aria-hidden='true'>
      <Skeleton width='220px' height='28px' />
      <div>
        <Skeleton width='320px' height='13px' />
      </div>
    </div>
  );
}

/** What a page that threw shows in its place, with the ways out. */
function PageError(props: { error: unknown; onRetry: () => void }) {
  const location = useLocation();
  onMount(() => {
    // The detail is for whoever debugs it, not for the page.
    console.error(props.error);
    document.title = pageTitle(t('Something went wrong'));
  });
  return (
    <div role='alert'>
      <ErrorState
        code={t('Error')}
        title={t('Something went wrong')}
        line={t('This page hit an error. Trying again usually fixes it.')}
      >
        <button type='button' class='btn btn-primary' onClick={() => props.onRetry()}>
          {t('Try again')}
        </button>
        {/* On the home page, Go home would land where the error is and leave it up. */}
        <Show when={location.pathname !== '/'}>
          <a href='/' class='btn btn-secondary'>
            {t('Go home')}
          </a>
        </Show>
      </ErrorState>
    </div>
  );
}

/**
 * Moves focus to the page's main content when the route's path changes, so a
 * keyboard or screen reader user starts on the new page rather than on the
 * link left behind. A change of query alone, as a tab or filter makes, keeps
 * focus where it is, and the first load leaves it to the browser.
 */
function useRouteFocus(target: () => HTMLElement | undefined): void {
  const location = useLocation();
  createEffect(
    on(
      () => location.pathname,
      () => target()?.focus({ preventScroll: true }),
      { defer: true }
    )
  );
}

/**
 * Clears the error screen when the route's path changes. Solid's boundary
 * keeps its error until reset, and every route renders inside this one, so
 * without it "Go home", the logo and every other in-app link would change the
 * address and leave the error up. Returns what the fallback hands its reset to.
 */
function useResetOnPath(): (reset: () => void) => void {
  const location = useLocation();
  let pending: (() => void) | undefined;
  createEffect(
    on(
      () => location.pathname,
      () => {
        const reset = pending;
        pending = undefined;
        if (reset) {
          // The next page names the tab itself; until then, not after the error.
          document.title = pageTitle();
          reset();
        }
      },
      { defer: true }
    )
  );
  return reset => {
    pending = reset;
  };
}

/**
 * Root layout. Every route renders inside this, under the site's head. The
 * ErrorBoundary catches any thrown render error in a page so a single bad
 * page doesn't take down the whole SPA.
 */
export const App: ParentComponent = props => {
  const isRouting = useIsRouting();
  let main: HTMLElement | undefined;
  useScrollRestoration();
  useRouteFocus(() => main);
  const resetOnPath = useResetOnPath();
  return (
    <>
      {/* Slim pending bar: instant feedback the moment a nav starts, for the
          cases that still take time (lazy chunk download on slow networks). */}
      <div class='route-progress' classList={{ active: isRouting() }} aria-hidden='true' />
      {/* The router takes in-page links over, so the link moves focus itself. */}
      <a
        class='skip-link'
        href='#main'
        onClick={event => {
          event.preventDefault();
          main?.focus();
        }}
      >
        {t('Skip to content')}
      </a>
      <SiteHead />
      <main ref={main} id='main' class='page' tabIndex={-1}>
        <ErrorBoundary
          fallback={(err, reset) => {
            resetOnPath(reset);
            // Loading while a stale chunk's reload is on its way; the error once the site is found out of reach.
            return (
              <Show when={!isRecoveringPreload()} fallback={<ChunkFallback />}>
                <PageError error={err} onRetry={reset} />
              </Show>
            );
          }}
        >
          {/* Routes are code-split (lazy()) — this boundary only covers route
              chunk loading. Page DATA must never suspend (see lib/resource.ts):
              a suspending read during nav freezes the old page for the whole
              fetch, and on cold load would blank the main area. */}
          <Suspense fallback={<ChunkFallback />}>{props.children}</Suspense>
        </ErrorBoundary>
      </main>
      <SiteFooter />
    </>
  );
};
