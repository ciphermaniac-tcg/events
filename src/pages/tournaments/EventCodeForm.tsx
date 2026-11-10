/**
 * A player's way to their event: its code, to its page. The home page's
 * second door and the dashboard's Playing tab both use it.
 */

import { createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { t } from '../../lib/i18n';

export function EventCodeForm() {
  const navigate = useNavigate();
  const [code, setCode] = createSignal('');
  return (
    <form
      class='tm-code-form'
      onSubmit={event => {
        event.preventDefault();
        const typed = code().replace(/\s+/g, '');
        if (typed) {
          navigate(`/t/${encodeURIComponent(typed.toUpperCase())}`);
        }
      }}
    >
      <input
        class='tm-input'
        placeholder={t('Event code')}
        aria-label={t('Event code')}
        autocomplete='off'
        autocapitalize='characters'
        spellcheck={false}
        required
        value={code()}
        onInput={event => setCode(event.currentTarget.value)}
      />
      <button type='submit' class='btn btn-secondary'>
        {t('Go')}
      </button>
    </form>
  );
}
