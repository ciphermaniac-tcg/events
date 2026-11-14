import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { Show } from 'solid-js';
import type { TomMode, TomStatus } from '../../../shared/native/tomCommands';
import type { TomState } from './tomState';

const MODE_OPTIONS: { value: TomMode; label: string }[] = [
  { value: 'inside', label: 'Inside TOM' },
  { value: 'keys', label: 'Speed Match typing' }
];

const MODE_NEEDS: Record<TomMode, string> = {
  inside: 'Needs TOM launched from this app.',
  keys: 'Needs Speed Match Slip Entry open in TOM. TOM comes to the front while codes are typed.'
};

function running(status: TomStatus): string {
  if (!status.running) {
    return 'Not running';
  }
  return status.inside ? 'Running, helper inside' : 'Running';
}

function statusLine(status: TomStatus | null): string {
  if (!status) {
    return 'Looking for TOM';
  }
  return status.path ? `${status.path} · ${running(status)}` : 'TOM not found';
}

export function TomSection(props: { state: TomState }) {
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
      </div>
      <div class='tp-mode'>
        <Segmented
          options={MODE_OPTIONS}
          selected={props.state.mode()}
          onSelect={mode => void props.state.choose(mode)}
          ariaLabel='How codes reach TOM'
        />
        <p class='muted'>{MODE_NEEDS[props.state.mode()]}</p>
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
