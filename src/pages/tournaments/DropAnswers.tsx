/**
 * The answers staff give an open drop request, wherever it is shown: the
 * console's head, the pairing check (DropCheck) and the Players tab.
 */

import type { PlayerRequest, RequestAnswer } from '../../../shared/tournament/requests';
import { answerRequest, type Manage } from '../../lib/tournament/api';
import { t } from '../../lib/i18n';
import type { ManageState } from './manageState';

/** The answers to one open request, by its ID: the server drops the player with a confirmed drop, in one write. */
export function Answers(props: { state: ManageState; manage: Manage; request: PlayerRequest }) {
  function answer(status: RequestAnswer) {
    const { code } = props.manage;
    const { id } = props.request;
    void props.state.run(() => answerRequest(code, { id, status }));
  }
  return (
    <span class='tm-row-actions'>
      <button type='button' class='btn btn-secondary tm-small' onClick={() => answer('accepted')}>
        {t('Confirm drop')}
      </button>
      <button type='button' class='btn btn-ghost tm-small' onClick={() => answer('declined')}>
        {t('Decline')}
      </button>
    </span>
  );
}
