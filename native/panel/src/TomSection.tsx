import { Show } from 'solid-js';
import type { TomPod, TomStatus } from '../../../shared/native/tomCommands';
import { categoryCode } from '../../../shared/tournament/tdf';
import { POD_CATEGORIES, POD_LABELS } from '../../../shared/tournament/types';
import type { Log } from './log';
import type { TomState } from './tomState';

function podName(code: number | undefined): string {
  const category = POD_CATEGORIES.find(c => categoryCode(c) === String(code));
  return category ? POD_LABELS[category] : 'Pod';
}

/** Each pod's current round as TOM's window shows it. */
const podLine = (pod: TomPod) =>
  `${podName(pod.category)} round ${pod.round} ${pod.started ? 'started' : 'not started'}`;

/** Whether TOM runs from here, and whether a code sent now would be tried, or why not. */
function readiness(status: TomStatus): string[] {
  const running = status.launched ? 'Launched from here' : 'Not launched from here';
  return [running, status.ready ? 'Ready' : (status.reason ?? 'Not ready')];
}

function statusLine(status: TomStatus | null): string {
  if (!status) {
    return 'Looking for TOM';
  }
  return [status.tomPath ?? 'TOM not found', ...readiness(status), ...status.pods.map(podLine)].join(' · ');
}

export function TomSection(props: { state: TomState; log: Log }) {
  return (
    <section class='tp-section' aria-labelledby='tp-tom'>
      <h2 id='tp-tom'>TOM</h2>
      <p class='tp-line'>{statusLine(props.state.status())}</p>
      <div class='tp-acts'>
        <button type='button' class='btn btn-primary' onClick={() => void props.state.launch()}>
          Launch TOM
        </button>
        <button type='button' class='btn btn-secondary' onClick={() => void props.state.locate()}>
          Choose TOM location
        </button>
        <button
          type='button'
          class='btn btn-secondary'
          disabled={props.log.busy()}
          onClick={() => void props.log.save()}
        >
          Save in TOM
        </button>
      </div>
      <Show when={props.state.error()}>
        {error => (
          <p class='tp-error' role='alert'>
            {error()}
          </p>
        )}
      </Show>
    </section>
  );
}
