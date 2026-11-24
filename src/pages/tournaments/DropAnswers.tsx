/**
 * The answers staff give an open drop request, wherever it is shown: the
 * console's head, the pairing check (DropCheck) and the Players tab.
 */

import { Show } from 'solid-js';
import type { PlayerRequest, RequestAnswer } from '../../../shared/tournament/requests';
import { repairable } from '../../../shared/tournament/rounds';
import { answerRequest, type Manage } from '../../lib/tournament/api';
import { currentMatchOf, namesById } from '../../lib/tournament/present';
import { t } from '../../lib/i18n';
import { ConfirmAction } from './ConfirmAction';
import type { ManageState } from './manageState';

/** Asked before a drop that takes away the player's table in a round not yet started, leaving the opponent to re-pair. */
function repairQuestion(manage: Manage, player: string): string | null {
  const seat = currentMatchOf(manage.tournament, player);
  const opponent = seat?.match.p1 === player ? seat.match.p2 : seat?.match.p1;
  if (!seat || !opponent || !repairable(seat.round)) {
    return null;
  }
  const names = namesById(manage.tournament);
  return t('Drop {name}? {opponent} will need a re-pair.', {
    name: names.get(player) ?? player,
    opponent: names.get(opponent) ?? opponent
  });
}

/** The answers to one open request, by its ID: the server drops the player with a confirmed drop, in one write. */
export function Answers(props: { state: ManageState; manage: Manage; request: PlayerRequest }) {
  function answer(status: RequestAnswer) {
    const { code } = props.manage;
    const { id } = props.request;
    void props.state.run(() => answerRequest(code, { id, status }));
  }
  const confirm = (
    <button type='button' class='btn btn-secondary tm-small' onClick={() => answer('accepted')}>
      {t('Confirm drop')}
    </button>
  );
  return (
    <span class='tm-row-actions'>
      <Show when={repairQuestion(props.manage, props.request.player)} fallback={confirm}>
        {question => (
          <ConfirmAction
            class='btn btn-secondary tm-small'
            label={t('Confirm drop')}
            question={question()}
            danger
            onConfirm={() => answer('accepted')}
          />
        )}
      </Show>
      <button type='button' class='btn btn-ghost tm-small' onClick={() => answer('declined')}>
        {t('Decline')}
      </button>
    </span>
  );
}
