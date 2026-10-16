/**
 * What players asked staff for, above the roster: open requests first, each
 * with its answers, then the answered ones with who answered and when (see
 * shared/tournament/requests.ts). Confirming a drop request at a Swiss event
 * drops the player in the same write as the answer (see the requests route); a TOM event's roster is TOM's,
 * so there staff drop them in TOM.
 */

import { For, Show } from 'solid-js';
import type { PlayerRequest, RequestAnswer } from '../../../shared/tournament/requests';
import { playerName } from '../../../shared/tournament/types';
import { answerRequest, type Manage } from '../../lib/tournament/api';
import { intlLocale, msg, t, tc } from '../../lib/i18n';
import type { ManageState } from './manageState';

/** What a request asks, as a noun: the staff table names the request, not the button the player pressed. */
const kindLabel = (kind: PlayerRequest['kind']) =>
  kind === 'drop' ? tc('request', 'Drop') : tc('request', 'Contact staff');

const STATUS_LABELS: Record<PlayerRequest['status'], string> = {
  open: msg('Waiting'),
  accepted: msg('Confirmed'),
  declined: msg('Declined'),
  done: msg('Contacted'),
  cancelled: msg('Cancelled')
};

const timeOf = (at: number) => new Date(at).toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' });

/** Open requests first, oldest first; then answered ones, latest first. Cancelled ones ask nothing. */
const ordered = (requests: readonly PlayerRequest[]) => [
  ...requests.filter(request => request.status === 'open').sort((a, b) => a.at - b.at),
  ...requests
    .filter(request => request.status !== 'open' && request.status !== 'cancelled')
    .sort((a, b) => (b.answeredAt ?? b.at) - (a.answeredAt ?? a.at))
];

/** The answers to one open request, by its ID: the server drops the player with a confirmed drop, in one write. */
function Answers(props: { state: ManageState; manage: Manage; request: PlayerRequest }) {
  function answer(status: RequestAnswer) {
    const { code } = props.manage;
    const { id } = props.request;
    void props.state.run(() => answerRequest(code, { id, status }));
  }
  return (
    <span class='tm-row-actions'>
      <Show
        when={props.request.kind === 'drop'}
        fallback={
          <button type='button' class='btn btn-secondary tm-small' onClick={() => answer('done')}>
            {t('Mark contacted')}
          </button>
        }
      >
        <button type='button' class='btn btn-secondary tm-small' onClick={() => answer('accepted')}>
          {t('Confirm drop')}
        </button>
        <button type='button' class='btn btn-ghost tm-small' onClick={() => answer('declined')}>
          {t('Decline')}
        </button>
      </Show>
    </span>
  );
}

function Status(props: { manage: Manage; request: PlayerRequest }) {
  const tomDrop = () =>
    props.manage.mode === 'tom' && props.request.kind === 'drop' && props.request.status === 'accepted';
  return (
    <>
      {t(STATUS_LABELS[props.request.status])}
      <Show when={props.request.answeredAt}>
        {at => (
          <span class='muted'>
            {' '}
            · {props.request.by ? `${props.request.by} · ` : ''}
            {timeOf(at())}
          </span>
        )}
      </Show>
      <Show when={tomDrop()}>
        <span class='muted'> · {t('drop in TOM')}</span>
      </Show>
    </>
  );
}

export function StaffRequests(props: { state: ManageState; manage: Manage }) {
  const requests = () => ordered(props.manage.requests ?? []);
  const name = (id: string) => {
    const player = props.manage.tournament.players.find(candidate => candidate.id === id);
    return player ? playerName(player) : id;
  };
  return (
    <Show when={requests().length > 0}>
      <section class='tm-box' aria-label={t('Player requests')}>
        <div class='table-wrap'>
          <table class='data tm-requests'>
            <thead>
              <tr>
                <th>{t('Player')}</th>
                <th>{t('Request')}</th>
                <th>{t('Asked')}</th>
                <th>{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={requests()}>
                {request => (
                  <tr>
                    <td>{name(request.player)}</td>
                    <td>{kindLabel(request.kind)}</td>
                    <td class='tm-num'>{timeOf(request.at)}</td>
                    <td>
                      <Show
                        when={request.status === 'open' && !props.manage.settings.finished}
                        fallback={<Status manage={props.manage} request={request} />}
                      >
                        <Answers state={props.state} manage={props.manage} request={request} />
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </section>
    </Show>
  );
}
