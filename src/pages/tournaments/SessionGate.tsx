import { type Accessor, type JSX, Show } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { t } from '../../lib/i18n';
import { latestValue } from '../../lib/resource';
import { errorText, type Session } from '../../lib/tournament/api';
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

export function SessionGate(props: { children: (current: Accessor<Session>) => JSX.Element }) {
  return (
    <Show when={latestValue(session)} fallback={<SessionFallback />}>
      {props.children}
    </Show>
  );
}
