/**
 * What players asked staff for, above the roster: open requests first, each
 * with its answers, then the answered ones with who answered and when (see
 * shared/tournament/requests.ts). Confirming a drop request at a Swiss event
 * drops the player in the same write as the answer (see the requests route); a TOM event's roster is TOM's,
 * so there staff drop them in TOM.
 */

import { For, Show } from 'solid-js';
import type { PlayerRequest } from '../../../shared/tournament/requests';
import { playerName } from '../../../shared/tournament/types';
import type { Manage } from '../../lib/tournament/api';
import { seatOf } from '../../lib/tournament/present';
import { msg, t, tc, timeOfDay } from '../../lib/i18n';
import type { ManageState } from './manageState';
import { Answers } from './DropCheck';

const STATUS_LABELS: Record<PlayerRequest['status'], string> = {
  open: msg('Waiting'),
  accepted: msg('Confirmed'),
  declined: msg('Declined'),
  cancelled: msg('Cancelled')
};

/** Where the player sits, so whoever answers can walk straight there. */
function seatText(manage: Manage, id: string): string {
  const seat = seatOf(manage.tournament, id);
  return seat === 'bye' ? t('Bye') : seat === null ? '—' : String(seat);
}

const seatLabel = (manage: Manage, id: string) =>
  typeof seatOf(manage.tournament, id) === 'number' ? t('Table') : undefined;

/** Open requests first, oldest first; then answered ones, latest first. Cancelled ones ask nothing. */
const ordered = (requests: readonly PlayerRequest[]) => [
  ...requests.filter(request => request.status === 'open').sort((a, b) => a.at - b.at),
  ...requests
    .filter(request => request.status !== 'open' && request.status !== 'cancelled')
    .sort((a, b) => (b.answeredAt ?? b.at) - (a.answeredAt ?? a.at))
];

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
            {timeOfDay(at())}
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
                <th>{t('Table')}</th>
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
                    {/* A phone names the seat as a table, its head gone (see tournament-console.css). */}
                    <td class='tm-num' data-label={seatLabel(props.manage, request.player)}>
                      {seatText(props.manage, request.player)}
                    </td>
                    <td>{tc('request', 'Drop')}</td>
                    <td class='tm-num'>{timeOfDay(request.at)}</td>
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
