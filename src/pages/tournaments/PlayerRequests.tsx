/**
 * The player's requests to staff, under their match: to drop, or for
 * someone to come over, each with where it stands. Nothing changes until
 * staff answer (see shared/tournament/requests.ts); an open request can be
 * taken back. Only the device that reports for the player asks.
 */

import { For, Show } from 'solid-js';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import { isLive, type PlayerRequest, type RequestKind, requestOf } from '../../../shared/tournament/requests';
import type { PublishedView, TournamentView } from '../../../shared/tournament/view';
import { ApiError, askStaff } from '../../lib/tournament/api';
import { msg, t, timeOfDay } from '../../lib/i18n';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { createAction } from './action';

/** What each kind's button says and how its request reads once made. */
const KINDS: { kind: RequestKind; ask: string; status: (request: PlayerRequest) => string }[] = [
  {
    kind: 'drop',
    ask: msg('Request drop'),
    status: request =>
      ({
        open: msg('Drop requested'),
        accepted: msg('Drop confirmed'),
        declined: msg('Drop declined'),
        done: '',
        cancelled: ''
      })[request.status]
  },
  {
    kind: 'staff',
    ask: msg('Contact staff'),
    status: request => (request.status === 'open' ? msg('Staff contact requested') : msg('Staff responded'))
  }
];

const timeOf = (at: number | undefined) => (at === undefined ? '' : ` · ${timeOfDay(at)}`);

export function PlayerRequests(props: {
  view: TournamentView;
  me: string;
  claim: PlayerClaim;
  reportToken: string | null;
  onView: (view: PublishedView) => void;
  onStale: () => void;
}) {
  const action = createAction();
  const requests = () => props.view.requests ?? [];
  const dropped = () => props.view.tournament.players.find(player => player.id === props.me)?.droppedAfter !== null;

  async function send(request: RequestKind, cancel = false) {
    const { claim, reportToken, onStale } = props;
    const { code } = props.view;
    const answer = await action.run(
      () => askStaff(code, claim, { request, cancel }, reportToken),
      err => {
        // No longer this device's player to ask for.
        if (err instanceof ApiError && (err.status === 403 || err.status === 409)) {
          onStale();
        }
      }
    );
    if (answer) {
      props.onView(answer.view);
    }
  }

  /** Whether the kind's button shows: no open request, and a drop only while still playing. */
  const askable = (kind: RequestKind, request: PlayerRequest | undefined) =>
    request?.status !== 'open' && !(kind === 'drop' && (dropped() || request?.status === 'accepted'));

  return (
    <div class='tm-you-panel tm-you-requests'>
      <For each={KINDS}>
        {entry => {
          // A cancelled request reads as none: the player may ask again once its cooldown passes.
          const request = () => {
            const made = requestOf(requests(), props.me, entry.kind);
            return isLive(made) ? made : undefined;
          };
          return (
            <>
              <Show when={request()}>
                {made => (
                  <span class='tm-you-request' role='status'>
                    {t(entry.status(made()))}
                    <span class='muted'>{timeOf(made().answeredAt ?? made().at)}</span>
                    <Show when={made().status === 'open'}>
                      <button
                        type='button'
                        class='btn btn-ghost tm-small'
                        disabled={action.busy()}
                        onClick={() => void send(entry.kind, true)}
                      >
                        {t('Cancel request')}
                      </button>
                    </Show>
                  </span>
                )}
              </Show>
              <Show when={askable(entry.kind, request())}>
                <Show
                  when={entry.kind === 'drop'}
                  fallback={
                    <button
                      type='button'
                      class='btn btn-secondary tm-small'
                      disabled={action.busy()}
                      onClick={() => void send(entry.kind)}
                    >
                      {t(entry.ask)}
                    </button>
                  }
                >
                  <ConfirmAction
                    label={t(entry.ask)}
                    class='btn btn-secondary tm-small'
                    question={t('Ask staff to drop you?')}
                    confirmLabel={t('Ask staff')}
                    onConfirm={() => void send(entry.kind)}
                  />
                </Show>
              </Show>
            </>
          );
        }}
      </For>
      <ErrorLine message={action.error()} />
    </div>
  );
}
