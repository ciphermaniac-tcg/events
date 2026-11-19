/**
 * What a table's menu adds to its results (see RoundPanel and ResultSheet):
 * first each seat, with the way to free it for another device or account
 * (see ReleaseAction), then after the results the link to the table's stream
 * overlay (see StreamOverlay), copied in place.
 */

import { For, Show } from 'solid-js';
import { type Match, type Player, playerName, type Pod } from '../../../shared/tournament/types';
import { isSanctioned } from '../../../shared/tournament/view';
import { t } from '../../lib/i18n';
import { type Manage, releaseReporter } from '../../lib/tournament/api';
import { ConfirmAction } from './ConfirmAction';
import { createCopied } from './copied';
import type { ManageState } from './manageState';

/**
 * Lets another device report for a player, as when they change phones or
 * someone else claimed them first, where players report. At an unsanctioned
 * event the same release undoes the Claim a signed-in account made on the
 * player, reporting or not, and there it reads as unlinking them. Staff are
 * not shown which players an account holds.
 */
const reportsFor = (manage: Manage, player: Player) => manage.settings.playerReporting && player.droppedAfter === null;

/** Whether ReleaseAction has anything to offer for the player. */
export const mayRelease = (manage: Manage, player: Player) => reportsFor(manage, player) || !isSanctioned(manage);

/** `short`: the small button a table's menu puts beside each seat's name, named by its answer alone. */
export function ReleaseAction(props: { state: ManageState; manage: Manage; player: Player; short?: boolean }) {
  const reporting = () => reportsFor(props.manage, props.player);
  const name = () => playerName(props.player);
  const answer = () => (reporting() ? t('Reset') : t('Unlink'));
  const full = () => (reporting() ? t('Reset reporting') : t('Unlink account'));
  return (
    <Show when={mayRelease(props.manage, props.player)}>
      <ConfirmAction
        label={props.short ? answer() : full()}
        class={props.short ? 'btn btn-ghost tm-small' : 'tm-menu-item'}
        question={
          reporting()
            ? t('Let another device report for {name}?', { name: name() })
            : t('Unlink {name} from their account?', { name: name() })
        }
        confirmLabel={answer()}
        onConfirm={() => void props.state.act(releaseReporter(props.manage.code, props.player.id))}
      />
    </Show>
  );
}

/** What a table's menu reads besides its table: the event, and the console that sends for it. */
export interface TableMenuOf {
  state: ManageState;
  manage: Manage;
}

/** The table's seats, each with Reset, while staff can free any of them. */
export function SeatResets(props: { state: ManageState; manage: Manage; match: Match }) {
  const seats = () =>
    props.manage.watching
      ? []
      : [props.match.p1, props.match.p2].flatMap(id => {
          const player = props.manage.tournament.players.find(p => p.id === id);
          return player && mayRelease(props.manage, player) ? [player] : [];
        });
  return (
    <Show when={seats().length}>
      <div class='tm-menu-seats'>
        <For each={seats()}>
          {player => (
            <p>
              <span>{playerName(player)}</span>
              <ReleaseAction state={props.state} manage={props.manage} player={player} short />
            </p>
          )}
        </For>
      </div>
    </Show>
  );
}

/** Copies the overlay's link for the table, naming the pod where the event pairs more than one. */
export function StreamLink(props: { manage: Manage; pod: Pod; table: number }) {
  const { copied, copy } = createCopied();
  const link = () => {
    const pod = props.manage.tournament.pods.length > 1 ? `&pod=${props.pod.category}` : '';
    return `${location.origin}/t/${props.manage.code}?stream=table&table=${String(props.table)}${pod}`;
  };
  return (
    <button type='button' class='tm-menu-item' data-keeps-menu onClick={() => void copy(link())}>
      {copied() ? t('Copied') : t('Copy stream overlay link')}
    </button>
  );
}
