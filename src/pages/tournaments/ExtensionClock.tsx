import { Show } from 'solid-js';
import type { Match, Round } from '../../../shared/tournament/types';
import { t } from '../../lib/i18n';
import { Clock } from './Clock';

export function ExtensionClock(props: { match: Match; round: Round; playing: boolean }) {
  return (
    <Show when={props.match.timeExtension}>
      {extension => (
        <span class='tm-extension num'>
          {t('+{minutes} min', { minutes: extension().seconds / 60 })}
          {/* Only while the table plays, so a past round's tables keep no timer. */}
          <Show when={props.playing && (props.round.clockStartedAt != null || props.round.startTime)}>
            {' · '}
            <Clock
              round={props.round}
              extraSeconds={extension().seconds}
              label={t('Time left at table {table}', { table: props.match.table })}
            />
          </Show>
        </span>
      )}
    </Show>
  );
}
