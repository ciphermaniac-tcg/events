/**
 * Staff check-in on the console's player list before round 1 (see
 * shared/tournament/checkins.ts): a column for each check the event asks
 * (Paid with an entry fee, In TOM at a TOM event, List received from anyone
 * handing in a paper list), each with how many are ticked, and above the list
 * who is still open. An event the site pairs waits on them for round 1, so
 * each comes with what lets it go: marking them, or dropping them. A TOM
 * event pairs in TOM, so it gets the count, and a warning if TOM's round 1
 * came in with anyone still open.
 */

import { createResource, For, Show } from 'solid-js';
import { type CheckMark, marksFor, notCheckedIn, openMarks } from '../../../shared/tournament/checkins';
import { hasStarted } from '../../../shared/tournament/rounds';
import { type Player, playerName } from '../../../shared/tournament/types';
import { fetchDecklists, type Manage, saveCheckIn } from '../../lib/tournament/api';
import { msg, t } from '../../lib/i18n';
import type { ManageState } from './manageState';

const MARK_LABELS: Record<CheckMark, string> = {
  paid: msg('Paid'),
  tom: msg('In TOM'),
  list: msg('List received')
};

const MARK_ACTIONS: Partial<Record<CheckMark, string>> = {
  paid: msg('Mark paid'),
  list: msg('Mark received')
};

const checkins = (manage: Manage) => manage.checkins ?? {};

/** Ticks or clears one check, through the console's state so the answer is the event shown. */
function tick(state: ManageState, code: string, check: { playerId: string; mark: CheckMark; on: boolean }) {
  void state.run(() => saveCheckIn(code, check));
}

/** The checks the event asks of anyone, in column order: a list only once someone chose paper. */
export function checkColumns(manage: Manage): CheckMark[] {
  const anyPaper = Object.values(checkins(manage)).some(held => held.paper);
  return marksFor(manage, anyPaper ? { paper: true } : undefined);
}

/** Whether the console shows check-in: before round 1, at an event that asks for any check. */
export const showsCheckIn = (manage: Manage) => !hasStarted(manage.tournament) && checkColumns(manage).length > 0;

export function CheckInHeads(props: { manage: Manage; players: readonly Player[] }) {
  const active = () => props.players.filter(player => player.droppedAfter === null);
  const ticked = (mark: CheckMark) => active().filter(player => checkins(props.manage)[player.id]?.[mark]).length;
  return (
    <For each={checkColumns(props.manage)}>
      {mark => (
        <th class='tm-check-col'>
          {t(MARK_LABELS[mark])}
          <span class='tm-check-count muted tm-num'>
            {t('{n}/{total}', { n: ticked(mark), total: active().length })}
          </span>
        </th>
      )}
    </For>
  );
}

export function CheckInCells(props: { state: ManageState; manage: Manage; id: string; name: string }) {
  const held = () => checkins(props.manage)[props.id];
  const asks = (mark: CheckMark) => marksFor(props.manage, held()).includes(mark);
  return (
    <For each={checkColumns(props.manage)}>
      {mark => (
        <td class='tm-check-col'>
          <Show when={asks(mark)}>
            <label class='tm-check-cell'>
              <input
                type='checkbox'
                class='tm-check-box'
                checked={held()?.[mark] === true}
                disabled={props.state.busy()}
                aria-label={`${t(MARK_LABELS[mark])}: ${props.name}`}
                onChange={e =>
                  tick(props.state, props.manage.code, { playerId: props.id, mark, on: e.currentTarget.checked })
                }
              />
              {/* The column's name, where a phone lays the row out without its head. */}
              <span class='tm-check-name' aria-hidden='true'>
                {t(MARK_LABELS[mark])}
              </span>
            </label>
          </Show>
        </td>
      )}
    </For>
  );
}

/** Who still holds round 1 back, with what lets each go. */
function Blockers(props: { state: ManageState; manage: Manage; open: readonly Player[] }) {
  return (
    <div class='tm-box-bar tm-check-gate'>
      <strong>
        {props.open.length === 1
          ? t('1 player isn’t checked in.')
          : t('{n} players aren’t checked in.', { n: props.open.length })}
      </strong>
      <ul class='tm-check-list'>
        <For each={props.open}>
          {player => (
            <li>
              <span>{playerName(player)}</span>
              <span class='tm-grow' />
              <For each={openMarks(props.manage, checkins(props.manage)[player.id])}>
                {mark => (
                  <Show when={MARK_ACTIONS[mark]}>
                    {label => (
                      <button
                        type='button'
                        class='btn btn-secondary tm-small'
                        disabled={props.state.busy()}
                        onClick={() => tick(props.state, props.manage.code, { playerId: player.id, mark, on: true })}
                      >
                        {t(label())}
                      </button>
                    )}
                  </Show>
                )}
              </For>
              <button
                type='button'
                class='btn btn-ghost tm-small'
                disabled={props.state.busy()}
                onClick={() => void props.state.send({ type: 'dropPlayer', id: player.id })}
              >
                {t('Drop')}
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

/** The roster's count against the event's cap, and how far past it staff added. */
export function capCount(manage: Manage, count: number): string {
  const cap = manage.settings.playerCap;
  if (cap === 0) {
    return '';
  }
  const over = count - cap;
  return over > 0
    ? `${t('{n} / {cap} players', { n: count, cap })} · ${t('{n} over the cap', { n: over })}`
    : t('{n} / {cap} players', { n: count, cap });
}

/** Above the player list: who is still open, or at a TOM event how many, and a warning once TOM paired them anyway. */
export function CheckInBox(props: { state: ManageState; manage: Manage; extra: readonly Player[] }) {
  const open = () =>
    notCheckedIn(props.manage, [...props.manage.tournament.players, ...props.extra], checkins(props.manage));
  const tom = () => props.manage.mode === 'tom';
  const asks = () => checkColumns(props.manage).length > 0;
  const total = () =>
    [...props.manage.tournament.players, ...props.extra].filter(player => player.droppedAfter === null).length;
  return (
    <Show when={asks()}>
      <Show
        when={!hasStarted(props.manage.tournament)}
        fallback={
          <Show when={tom() && open().length > 0}>
            <section class='tm-box'>
              <p class='tm-box-bar tm-check-warn' role='alert'>
                {open().length === 1
                  ? t('Round 1 came in from TOM with 1 player not checked in.')
                  : t('Round 1 came in from TOM with {n} players not checked in.', { n: open().length })}
              </p>
            </section>
          </Show>
        }
      >
        <section class='tm-box'>
          <Show
            when={open().length > 0}
            fallback={<p class='tm-box-bar tm-check-done'>{t('Everyone is checked in.')}</p>}
          >
            <Show
              when={!tom()}
              fallback={
                <p class='tm-box-bar'>
                  {open().length === 1
                    ? t('1 of {total} players isn’t checked in.', { total: total() })
                    : t('{n} of {total} players aren’t checked in.', { n: open().length, total: total() })}
                </p>
              }
            >
              <Blockers state={props.state} manage={props.manage} open={open()} />
            </Show>
          </Show>
        </section>
      </Show>
    </Show>
  );
}

/**
 * At a TOM event before round 1, everyone who registered on the site and is
 * not in TOM's file yet, as players for check-in: staff enter them in TOM
 * and tick them off here.
 */
export function createSiteRegistrants(manage: () => Manage) {
  const [lists] = createResource(
    () => (manage().mode === 'tom' && !hasStarted(manage().tournament) ? manage().code : null),
    code => fetchDecklists(code)
  );
  return (): Player[] => {
    const known = new Set(manage().tournament.players.map(player => player.id));
    return (lists.latest?.decklists ?? [])
      .filter(list => !known.has(list.popId))
      .map(list => ({
        id: list.popId,
        firstName: list.firstName,
        lastName: list.lastName,
        birthDate: list.birthDate,
        droppedAfter: null,
        created: '',
        modified: ''
      }));
  };
}
