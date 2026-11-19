/**
 * The drop requests still open when staff pair the next round (see
 * dropGate): each with its answers, as on the Players tab (see
 * StaffRequests), then Cancel and the pairing, past the requests on purpose
 * while any is open.
 */

import { For, Show } from 'solid-js';
import type { PlayerRequest } from '../../../shared/tournament/requests';
import type { Manage } from '../../lib/tournament/api';
import { namesById } from '../../lib/tournament/present';
import { t } from '../../lib/i18n';
import type { ManageState } from './manageState';
import { Modal } from './Modal';
import { Answers } from './DropAnswers';

/** The check itself, in a dialog: each request with its answers, then Cancel and the pairing. */
export function DropCheck(props: {
  state: ManageState;
  manage: Manage;
  drops: readonly PlayerRequest[];
  label: string;
  open: boolean;
  onPair: () => void;
  onClose: () => void;
}) {
  const names = () => namesById(props.manage.tournament);
  const waiting = () => props.drops.length > 0;
  return (
    <Modal open={props.open} title={t('Drop requests')} class='tm-drop-check' onClose={props.onClose}>
      <div class='tm-box-bar tm-modal-body'>
        <Show when={waiting()} fallback={<p class='muted'>{t('No drop requests waiting.')}</p>}>
          <ul class='tm-check-list'>
            <For each={props.drops}>
              {request => (
                <li>
                  <span>{names().get(request.player) ?? request.player}</span>
                  <span class='tm-grow' />
                  <Answers state={props.state} manage={props.manage} request={request} />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={() => props.onClose()}>
          {t('Cancel')}
        </button>
        <button
          type='button'
          class={waiting() ? 'btn btn-secondary' : 'btn btn-primary'}
          disabled={props.state.busy()}
          onClick={() => props.onPair()}
        >
          {waiting() ? t('Pair anyway') : props.label}
        </button>
      </div>
    </Modal>
  );
}
