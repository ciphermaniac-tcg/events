import { Show } from 'solid-js';
import { intlLocale, t, tx } from '../../lib/i18n';
import { EMPTY_LIVE_DATA, LIVE_FAILURE_LABELS, type LiveData, liveDataStale } from '../../lib/tournament/liveData';
import { createNow } from './now';

/** The time of day the page last heard from the event: "3:14 PM". */
export const checkedTime = (at: number) =>
  new Date(at).toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' });

/**
 * Quiet context alongside the last readable event; never replaces its
 * pairings. Without `onRetry`, for a screen the room reads, it offers no Retry.
 */
export function LiveDataStatus(props: { data?: LiveData; onRetry?: () => void }) {
  const now = createNow();
  const data = () => props.data ?? EMPTY_LIVE_DATA;
  const label = () => (data().failure ? t(LIVE_FAILURE_LABELS[data().failure!]) : t('Updates delayed'));
  const time = () => (data().checkedAt ? checkedTime(data().checkedAt!) : '—');
  return (
    <Show when={liveDataStale(data(), now())}>
      <div class='tm-live-data' role='status'>
        <span>{label()}</span>
        <span>{tx('Last checked {time}', { time: <time>{time()}</time> })}</span>
        <Show when={props.onRetry}>
          {retry => (
            <button type='button' class='btn btn-secondary' onClick={() => retry()()}>
              {t('Retry')}
            </button>
          )}
        </Show>
      </div>
    </Show>
  );
}
