import { createSignal, Show, untrack } from 'solid-js';
import { EXTENSION_REASON_MAX, type ExtensionCommand } from '../../../shared/tournament/timeExtensions';
import type { Match, PodCategory } from '../../../shared/tournament/types';
import { t } from '../../lib/i18n';
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
  const [minutes, setMinutes] = createSignal((selection.match.timeExtension?.seconds ?? 0) / 60);
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
          <Field id='extension-minutes' label={t('Extra minutes')}>
            <input
              id='extension-minutes'
              class='tm-input'
              type='number'
              min='0'
              max='60'
              step='1'
              required
              value={minutes()}
              onInput={event => setMinutes(Number(event.currentTarget.value))}
            />
          </Field>
          <Field id='extension-reason' label={t('Reason')}>
            <input
              id='extension-reason'
              class='tm-input'
              maxLength={EXTENSION_REASON_MAX}
              value={reason()}
              onInput={event => setReason(event.currentTarget.value)}
            />
          </Field>
          <ErrorLine message={props.state.error()} />
        </div>
        <div class='tm-box-bar tm-modal-foot'>
          <Show when={selection.match.timeExtension}>
            <button type='button' class='btn btn-ghost' disabled={props.state.busy()} onClick={() => void save(0)}>
              {t('Remove extension')}
            </button>
          </Show>
          <button type='button' class='btn btn-ghost' disabled={props.state.busy()} onClick={() => props.onClose()}>
            {t('Cancel')}
          </button>
          <button type='submit' class='btn btn-primary' disabled={props.state.busy()}>
            {t('Save extension')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
