import { createSignal, Show, untrack } from 'solid-js';
import { EXTENSION_REASON_MAX, type ExtensionCommand } from '../../../shared/tournament/timeExtensions';
import type { Match, PodCategory } from '../../../shared/tournament/types';
import { t, tn } from '../../lib/i18n';
import { ErrorLine, Field } from './Field';
import type { ManageState } from './manageState';
import { Modal } from './Modal';

export interface ExtensionSelection {
  pod: PodCategory;
  round: number;
  match: Match;
}

export function TimeExtensionDialog(props: { state: ManageState; selection: ExtensionSelection; onClose: () => void }) {
  // The editor keeps the pairing it opened on, even if a poll replaces it.
  const selection = untrack(() => props.selection);
  const editing = selection.match.timeExtension;
  // A new extension starts at the usual three minutes; an existing one at what it gives.
  const [minutes, setMinutes] = createSignal(editing ? editing.seconds / 60 : 3);
  const step = (by: number) => setMinutes(n => Math.min(60, Math.max(0, n + by)));
  const [reason, setReason] = createSignal(selection.match.timeExtension?.reason ?? '');

  async function save(seconds: number) {
    const { table, p1, p2 } = selection.match;
    const command: ExtensionCommand = {
      type: 'setTimeExtension',
      pod: selection.pod,
      round: selection.round,
      table,
      p1,
      p2: p2!,
      seconds,
      reason: seconds === 0 ? '' : reason()
    };
    if (await props.state.send(command)) {
      props.onClose();
    }
  }

  return (
    <Modal open title={t('Time extension, table {table}', { table: selection.match.table })} onClose={props.onClose}>
      <form
        onSubmit={event => {
          event.preventDefault();
          void save(minutes() * 60);
        }}
      >
        <div class='tm-box-bar tm-modal-body'>
          <Field id='extension-minutes' label={t('Extra time')}>
            <span class='tm-minutes'>
              <button type='button' aria-label={t('Take a minute off')} onClick={() => step(-1)}>
                −
              </button>
              <output id='extension-minutes' aria-live='polite'>
                {t('{n} min', { n: minutes() })}
              </output>
              <button type='button' aria-label={t('Add a minute')} onClick={() => step(1)}>
                +
              </button>
            </span>
          </Field>
          <Field id='extension-reason' label={t('Reason')}>
            <input
              id='extension-reason'
              class='tm-input'
              enterkeyhint='done'
              maxLength={EXTENSION_REASON_MAX}
              value={reason()}
              onInput={event => setReason(event.currentTarget.value)}
            />
          </Field>
          <ErrorLine message={props.state.error()} />
        </div>
        <div class='tm-box-bar tm-modal-foot'>
          <Show when={editing}>
            <button type='button' class='btn btn-ghost' disabled={props.state.busy()} onClick={() => void save(0)}>
              {t('Remove extension')}
            </button>
          </Show>
          <button type='button' class='btn btn-ghost' disabled={props.state.busy()} onClick={() => props.onClose()}>
            {t('Cancel')}
          </button>
          <button type='submit' class='btn btn-primary' disabled={props.state.busy() || !(minutes() > 0)}>
            {editing ? t('Save extension') : tn(minutes(), 'Add {n} minute', 'Add {n} minutes')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
