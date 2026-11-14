import { createSignal, Show } from 'solid-js';
import { matchSlips, parseSlipCode } from '../../../shared/tournament/slipCodes';
import type { Tournament } from '../../../shared/tournament/types';
import type { Log } from './log';

/**
 * A code typed by hand, sent as the entry of the one slip it reads as in the
 * linked .tdf. Without a file, or with a code that reads as no slip or as
 * more than one, it is refused here.
 */
export function ManualCode(props: { tournament: Tournament | null; log: Log }) {
  const [code, setCode] = createSignal('');
  const [invalid, setInvalid] = createSignal(false);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const value = code().trim();
    const entry = props.tournament ? parseSlipCode(matchSlips(props.tournament), value) : null;
    setInvalid(!entry);
    if (entry) {
      setCode('');
      void props.log.send([{ entry, what: `Typed ${value}` }]);
    }
  };
  return (
    <section class='tp-section' aria-labelledby='tp-manual'>
      <h2 id='tp-manual'>Enter a code</h2>
      <form class='tp-acts' onSubmit={submit}>
        <label for='tp-code'>Code</label>
        <input
          id='tp-code'
          class='tp-field'
          inputmode='numeric'
          autocomplete='off'
          value={code()}
          aria-invalid={invalid()}
          aria-describedby={invalid() ? 'tp-code-error' : undefined}
          onInput={event => setCode(event.currentTarget.value)}
        />
        <button type='submit' class='btn btn-secondary' disabled={props.log.busy()}>
          Send
        </button>
      </form>
      <Show when={invalid()}>
        <p id='tp-code-error' class='tp-error'>
          {props.tournament ? 'Not a slip code for this event' : 'Link a .tdf first'}
        </p>
      </Show>
    </section>
  );
}
