import { type Component, type ComponentProps, ErrorBoundary, lazy, onCleanup, Show } from 'solid-js';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { t } from '../../lib/i18n';
import { isRecoveringPreload, retryable, siteAnswers } from '../../lib/preloadRecovery';
import { ErrorLine } from './Field';

/**
 * A code-split panel or sheet that fails on its own. Its chunk can fail to
 * arrive when the venue's Wi-Fi drops, and so can its render; either way the
 * rest of the page stays up, with a line and a way to try the panel again.
 * `preload` fetches the chunk ahead of need (see warmChunks).
 */
export function lazyPanel<T extends Component<any>>(load: () => Promise<{ default: T }>) {
  const Panel = lazy(retryable(load));
  const Guarded = (props: ComponentProps<T>) => (
    <ErrorBoundary
      fallback={(err, reset) => {
        // The detail is for whoever debugs it, not for the page.
        console.error(err);
        return (
          <Show when={!isRecoveringPreload()} fallback={<Skeleton height='160px' />}>
            <ErrorLine message={t('Couldn’t load this section.')} />
            <button type='button' class='btn btn-secondary' onClick={() => reset()}>
              {t('Try again')}
            </button>
          </Show>
        );
      }}
    >
      <Panel {...props} />
    </ErrorBoundary>
  );
  return Object.assign(Guarded, { preload: Panel.preload });
}

/** How often a screen on air that failed asks whether the site answers again. */
const ON_AIR_RETRY_MS = 15_000;

/** Tries again, through `retry`, the first time the site answers, until the boundary it is for moves on. */
function retryOnceAnswering(retry: () => void): void {
  let gone = false;
  const timer = setInterval(() => {
    void siteAnswers().then(answers => {
      if (answers && !gone) {
        retry();
      }
    });
  }, ON_AIR_RETRY_MS);
  onCleanup(() => {
    gone = true;
    clearInterval(timer);
  });
}

/**
 * A code-split screen the room or a broadcast shows: the big screen and a
 * stream overlay. Nobody is there to press Try again and the audience can do
 * nothing about an error, so one that fails draws nothing over the game and
 * tries again on its own once the site answers.
 */
export function lazyOnAir<T extends Component<any>>(load: () => Promise<{ default: T }>) {
  const Screen = lazy(retryable(load));
  return (props: ComponentProps<T>) => (
    <ErrorBoundary
      fallback={(err, reset) => {
        console.error(err);
        retryOnceAnswering(reset);
        return null;
      }}
    >
      <Screen {...props} />
    </ErrorBoundary>
  );
}
