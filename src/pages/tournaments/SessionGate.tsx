import { type Accessor, type JSX, Show } from 'solid-js';
import { Skeleton } from '../../components/Skeleton';
import { latestValue } from '../../lib/resource';
import { type Session } from '../../lib/tournament/api';
import { RetryError } from './Field';
import { refreshSession, session } from './session';

function SessionFallback() {
  return (
    <Show
      when={session.state === 'errored'}
      fallback={
        <div role='status' aria-label='Loading' aria-busy='true'>
          <Skeleton height='200px' />
        </div>
      }
    >
      <RetryError error={session.error} onRetry={() => void refreshSession()} />
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
