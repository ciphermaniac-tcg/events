/**
 * What staff can do to a player from their roster row: reinstate them, and
 * under the row's menu fix their table, edit them, remove, drop or
 * disqualify them, and free them for another device or account. Each that
 * can't be taken back asks first (see ConfirmAction).
 */

import { createMemo, createSignal, Show } from 'solid-js';
import { hasPlayed, hasStarted, podOf } from '../../../shared/tournament/rounds';
import { type Player, playerName } from '../../../shared/tournament/types';
import { type ReturnEffects, returnEffects } from '../../../shared/tournament/returns';
import { isSanctioned } from '../../../shared/tournament/view';
import { type Manage, releaseReporter } from '../../lib/tournament/api';
import { t } from '../../lib/i18n';
import { ConfirmAction } from './ConfirmAction';
import { EditPlayerDialog } from './EditPlayer';
import type { ManageState } from './manageState';
import { OptionsMenu } from './OptionsMenu';

/**
 * Static seating: a player who cannot move between tables keeps one. Saved
 * when the field loses focus or Enter is pressed; emptied, it frees the table.
 * A table refused (another player's, or 0) goes back to the one saved.
 */
function FixedTableField(props: { state: ManageState; player: Player }) {
  // Only this field's own save holds it: another request from the console would blur it mid-typing.
  const [saving, setSaving] = createSignal(false);
  async function save(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const input = event.currentTarget;
    const value = input.value.replace(/\D/g, '');
    const table = value ? Number(value) : null;
    if (table === (props.player.fixedTable ?? null)) {
      return;
    }
    setSaving(true);
    try {
      await props.state.send({ type: 'setFixedTable', id: props.player.id, table });
    } finally {
      setSaving(false);
    }
    input.value = String(props.player.fixedTable ?? '');
  }
  return (
    <label class='tm-menu-field' title={t('Static seating: this player sits at the same table every round')}>
      {t('Fixed table')}
      <input
        class='tm-input tm-table-input'
        disabled={saving()}
        inputmode='numeric'
        aria-label={t('Fixed table for {name}', { name: playerName(props.player) })}
        placeholder='—'
        value={props.player.fixedTable ?? ''}
        onChange={e => void save(e)}
      />
    </label>
  );
}

/**
 * Lets another device report for a player, as when they change phones or
 * someone else claimed them first, where players report. At an unsanctioned
 * event the same release undoes the Claim a signed-in account made on the
 * player, reporting or not, and there it reads as unlinking them. Staff are
 * not shown which players an account holds.
 */
const reportsFor = (manage: Manage, player: Player) => manage.settings.playerReporting && player.droppedAfter === null;

/** Whether ReleaseAction has anything to offer for the player. */
const mayRelease = (manage: Manage, player: Player) => reportsFor(manage, player) || !isSanctioned(manage);

function ReleaseAction(props: { state: ManageState; manage: Manage; player: Player }) {
  const reporting = () => reportsFor(props.manage, props.player);
  const name = () => playerName(props.player);
  return (
    <Show when={mayRelease(props.manage, props.player)}>
      <ConfirmAction
        label={reporting() ? t('Reset reporting') : t('Unlink account')}
        class='tm-menu-item'
        question={
          reporting()
            ? t('Let another device report for {name}?', { name: name() })
            : t('Unlink {name} from their account?', { name: name() })
        }
        confirmLabel={reporting() ? t('Reset') : t('Unlink')}
        onConfirm={() => void props.state.act(releaseReporter(props.manage.code, props.player.id))}
      />
    </Show>
  );
}

/** Whether staff can do anything to the player here: anything at all until the event ends, then only free them. */
export const offersActions = (manage: Manage, player: Player) =>
  !manage.settings.finished || mayRelease(manage, player);

/** What reinstating a player does besides (see returnEffects), or why it can't be done. */
function returnScope(effects: ReturnEffects): string | undefined {
  if (effects.refusal) {
    return t(effects.refusal);
  }
  return (
    [
      effects.byeRound ? t('They get a bye for round {round}.', { round: effects.byeRound }) : '',
      effects.liftsDisqualification ? t('This lifts their disqualification.') : ''
    ]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

/**
 * Drop, disqualify, reinstate, remove (only before the player's first match:
 * after it they are dropped). A drop or disqualification can be taken back
 * while returnEffects offers it, asked first, since a return can bring a bye
 * or be refused. Staff can also free the player for another
 * device or account (see ReleaseAction), which alone stays once the event has
 * ended: the roster stands with its results until the event is reopened.
 *
 * The roster's menu also opens the player's sheet (`onDetails`). The sheet
 * offers these same actions in its foot, under a menu named in words
 * (`menuLabel`) rather than the row's dots.
 */
export function PlayerActions(props: {
  state: ManageState;
  manage: Manage;
  player: Player;
  onDetails?: () => void;
  menuLabel?: string;
}) {
  const send = (type: 'dropPlayer' | 'disqualifyPlayer' | 'undropPlayer' | 'removePlayer') =>
    void props.state.send({ type, id: props.player.id });
  const pod = () => podOf(props.manage.tournament, props.player.id);
  const dropped = () => props.player.droppedAfter;
  const ended = () => props.manage.settings.finished;
  const returned = createMemo(() => returnEffects(props.manage.tournament, props.player.id));
  const [editing, setEditing] = createSignal(false);
  return (
    <>
      <Show when={editing()}>
        <EditPlayerDialog
          state={props.state}
          player={props.player}
          sanctioned={isSanctioned(props.manage)}
          open
          onClose={() => setEditing(false)}
        />
      </Show>
      <span class='tm-row-actions'>
        <Show when={!ended() && returned().offered}>
          <ConfirmAction
            label={t('Reinstate')}
            class={props.menuLabel ? 'btn btn-secondary' : 'btn btn-ghost tm-small'}
            question={t('Reinstate {name}?', { name: playerName(props.player) })}
            scope={returnScope(returned())}
            refused={returned().refusal !== undefined}
            confirmLabel={t('Reinstate')}
            onConfirm={() => send('undropPlayer')}
          />
        </Show>
        <Show when={props.onDetails || offersActions(props.manage, props.player)}>
          <OptionsMenu
            name={playerName(props.player)}
            buttonClass={props.menuLabel ? 'btn btn-secondary' : undefined}
            buttonLabel={props.menuLabel ? t('Actions for {name}', { name: playerName(props.player) }) : undefined}
            buttonContent={props.menuLabel}
          >
            <Show when={props.onDetails}>
              {open => (
                <button type='button' class='tm-menu-item' data-closes-menu onClick={() => open()()}>
                  {t('Details')}
                </button>
              )}
            </Show>
            <Show when={!ended()}>
              <FixedTableField state={props.state} player={props.player} />
            </Show>
            <Show when={!ended()}>
              <button type='button' class='tm-menu-item' data-closes-menu onClick={() => setEditing(true)}>
                {t('Edit')}
              </button>
            </Show>
            {/* Once paired, a player is dropped rather than removed, so their opponents keep the match. */}
            <Show when={!ended() && !hasPlayed(pod(), props.player.id)}>
              <ConfirmAction
                label={t('Remove')}
                question={t('Remove {name}?', { name: playerName(props.player) })}
                class='tm-menu-item'
                danger
                onConfirm={() => send('removePlayer')}
              />
            </Show>
            <Show when={!ended() && dropped() === null}>
              {/* Before round 1 a drop is a removal (see unplayedDrop), which Remove already offers. */}
              <Show when={hasStarted(props.manage.tournament)}>
                <ConfirmAction
                  label={t('Drop')}
                  question={t('Drop {name}? You can reinstate them until the next round is paired.', {
                    name: playerName(props.player)
                  })}
                  class='tm-menu-item'
                  danger
                  onConfirm={() => send('dropPlayer')}
                />
              </Show>
              <ConfirmAction
                label={t('Disqualify')}
                question={t('Disqualify {name}? It goes in the event file. Write the penalty note under Penalties.', {
                  name: playerName(props.player)
                })}
                class='tm-menu-item'
                danger
                onConfirm={() => send('disqualifyPlayer')}
              />
            </Show>
            <ReleaseAction state={props.state} manage={props.manage} player={props.player} />
          </OptionsMenu>
        </Show>
      </span>
    </>
  );
}
