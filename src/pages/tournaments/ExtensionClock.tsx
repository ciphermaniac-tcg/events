import { Show } from 'solid-js';
import type { Match, Round } from '../../../shared/tournament/types';
import { clockLabel } from '../../lib/tournament/present';
import { createNow } from './now';

export function ExtensionClock(props: { match: Match; round: Round; playing: boolean }) {
  const now = createNow();
  return (
    <Show when={props.match.timeExtension}>
      {extension => (
        <span class='tm-extension num'>
          +{extension().seconds / 60} min
          <Show when={props.playing && (props.round.clockStartedAt != null || props.round.startTime)}>
            <span role='timer' aria-label={`Time left at table ${props.match.table}`}>
              {' '}
              · {clockLabel(props.round, now(), extension().seconds)}
            </span>
          </Show>
        </span>
      )}
    </Show>
  );
}
