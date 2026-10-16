import { Show } from 'solid-js';
import type { Match, Round } from '../../../shared/tournament/types';
import { t } from '../../lib/i18n';
import { clockLabel } from '../../lib/tournament/present';
import { createNow } from './now';

export function ExtensionClock(props: { match: Match; round: Round; playing: boolean }) {
  return (
    <Show when={props.match.timeExtension}>
      {extension => (
        <span class='tm-extension num'>
          {t('+{minutes} min', { minutes: extension().seconds / 60 })}
          <Show when={props.playing && (props.round.clockStartedAt != null || props.round.startTime)}>
            {_playing => {
              // Made only while the table plays, so a past round's tables keep no timer.
              const now = createNow();
              return (
                <span role='timer' aria-label={t('Time left at table {table}', { table: props.match.table })}>
                  {' '}
                  · {clockLabel(props.round, now(), extension().seconds)}
                </span>
              );
            }}
          </Show>
        </span>
      )}
    </Show>
  );
}
