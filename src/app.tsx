import { createEffect, ErrorBoundary, on, type ParentComponent, Suspense } from 'solid-js';
import { useIsRouting, useLocation } from '@solidjs/router';
import { SiteFooter } from './components/SiteFooter';
import { Skeleton } from './components/Skeleton';
import { ErrorState } from './components/ErrorState';
import { SiteHead } from './components/SiteHead';
import { useScrollRestoration } from './lib/scrollRestore';
import { isRecoveringPreload } from './lib/preloadRecovery';

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
 * Root layout. Every route renders inside this, under the site's head. The
 * ErrorBoundary catches any thrown render error in a page so a single bad
 * page doesn't take down the whole SPA.
 */
export const App: ParentComponent = props => {
  const isRouting = useIsRouting();
  let main: HTMLElement | undefined;
  useScrollRestoration();
  useRouteFocus(() => main);
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
        Skip to content
      </a>
      <SiteHead />
      <main ref={main} id='main' class='page' tabIndex={-1}>
        <ErrorBoundary
          fallback={(err, reset) => {
            if (isRecoveringPreload()) {
              return <ChunkFallback />;
            }
            // The detail is for whoever debugs it, not for the page.
            console.error(err);
            return (
              <div role='alert'>
                <ErrorState
                  code='Error'
                  title='Something went wrong'
                  line='This page hit a problem it couldn’t recover from. Trying again usually works.'
                >
                  <button type='button' class='btn btn-primary' onClick={reset}>
                    Try again
                  </button>
                  <a href='/' class='btn btn-secondary'>
                    Go home
                  </a>
                </ErrorState>
              </div>
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
