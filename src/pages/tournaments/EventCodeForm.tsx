/**
 * A player's way to their event: its code, or a pasted link to it, to its
 * page. The home page's second door and the dashboard's Playing tab both use it.
 */

import { createSignal, createUniqueId, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { eventCodeIn } from '../../../shared/tournament/eventCode';
import { t } from '../../lib/i18n';

export function EventCodeForm() {
  const navigate = useNavigate();
  const [code, setCode] = createSignal('');
  const [wrong, setWrong] = createSignal(false);
  const errorId = createUniqueId();
  return (
    <form
      class='tm-code-form'
      onSubmit={event => {
        event.preventDefault();
        const found = eventCodeIn(code(), location.host);
        setWrong(found === null);
        if (found) {
          navigate(`/t/${found}`);
        }
      }}
    >
      <input
        class='tm-input'
        placeholder={t('Event code or link')}
        aria-label={t('Event code or link')}
        aria-invalid={wrong() || undefined}
        aria-describedby={wrong() ? errorId : undefined}
        autocomplete='off'
        autocapitalize='characters'
        spellcheck={false}
        required
        value={code()}
        onInput={event => {
          setCode(event.currentTarget.value);
          setWrong(false);
        }}
      />
      <button type='submit' class='btn btn-secondary'>
        {t('Go')}
      </button>
      <Show when={wrong()}>
        <span class='tm-error' id={errorId} role='alert'>
          {t('That isn’t an event code or link.')}
        </span>
      </Show>
    </form>
  );
}
