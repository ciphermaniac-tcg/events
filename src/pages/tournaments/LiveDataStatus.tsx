import { Show } from 'solid-js';
import { EMPTY_LIVE_DATA, LIVE_FAILURE_LABELS, type LiveData, liveDataStale } from '../../lib/tournament/liveData';
import { createNow } from './now';

/** Quiet context alongside the last readable event; never replaces its pairings. */
export function LiveDataStatus(props: { data?: LiveData; onRetry?: () => void }) {
  const now = createNow();
  const data = () => props.data ?? EMPTY_LIVE_DATA;
  const label = () => (data().failure ? LIVE_FAILURE_LABELS[data().failure!] : 'Updates delayed');
  const time = () =>
    data().checkedAt ? new Date(data().checkedAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  return (
    <Show when={liveDataStale(data(), now())}>
      <div class='tm-live-data' role='status'>
        <span>{label()}</span>
        <span>
          Last updated <time>{time()}</time>
        </span>
        <button type='button' class='btn btn-secondary' onClick={() => props.onRetry?.()}>
          Retry
        </button>
      </div>
    </Show>
  );
}
