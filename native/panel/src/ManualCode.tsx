import { createSignal, Show } from 'solid-js';
import { isSlipCode } from '../../../shared/tournament/slipCodes';
import type { Log } from './log';

/** A code typed by hand, refused here when TOM would not take it. */
export function ManualCode(props: { log: Log }) {
  const [code, setCode] = createSignal('');
  const [invalid, setInvalid] = createSignal(false);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const value = code().trim();
    const valid = isSlipCode(value);
    setInvalid(!valid);
    if (valid) {
      setCode('');
      void props.log.send([{ code: value, what: 'Typed code' }]);
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
          Not a valid slip code
        </p>
      </Show>
    </section>
  );
}
