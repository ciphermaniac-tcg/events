import { type Accessor, type JSX, Show } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { t } from '../../lib/i18n';
import { latestValue } from '../../lib/resource';
import { ApiError, errorText, type Session } from '../../lib/tournament/api';
import { refreshSession, session } from './session';

/** Until the account is read: loading, or, when the read failed, the page's error with the ways on. */
function SessionFallback() {
  const location = useLocation();
  return (
    <Show
      when={session.state === 'errored'}
      fallback={
        <div role='status' aria-label={t('Loading')} aria-busy='true'>
          <Skeleton height='200px' />
        </div>
      }
    >
      <div role='alert'>
        <ErrorState code={t('Error')} title={t('Couldn’t load this page')} line={errorText(session.error)}>
          <button type='button' class='btn btn-primary' onClick={() => void refreshSession()}>
            {t('Try again')}
          </button>
          <Show when={location.pathname !== '/'}>
            <A href='/' class='btn btn-secondary'>
              {t('Go home')}
            </A>
          </Show>
        </ErrorState>
      </div>
    </Show>
  );
}

/** A store page or its settings when the store could not be read: not found, or try again; either way, home. */
export function StoreLoadError(props: { error: unknown; onRetry: () => void }) {
  const missing = () => props.error instanceof ApiError && props.error.status === 404;
  return (
    <ErrorState
      code={t('Store')}
      title={missing() ? t('Store not found') : t('Couldn’t load this store')}
      line={
        missing()
          ? t(
              'This address doesn’t match anything on Ciphermaniac Events. It may have moved, or the link may be mistyped.'
            )
          : errorText(props.error)
      }
    >
      <Show when={!missing()}>
        <button type='button' class='btn btn-primary' onClick={() => props.onRetry()}>
          {t('Try again')}
        </button>
      </Show>
      <A href='/' class={missing() ? 'btn btn-primary' : 'btn btn-secondary'}>
        {t('Go home')}
      </A>
    </ErrorState>
  );
}

export function SessionGate(props: { children: (current: Accessor<Session>) => JSX.Element }) {
  return (
    <Show when={latestValue(session)} fallback={<SessionFallback />}>
      {props.children}
    </Show>
  );
}
