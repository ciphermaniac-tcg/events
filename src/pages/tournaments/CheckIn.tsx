/**
 * Staff check-in on the console's player list before round 1 (see
 * shared/tournament/checkins.ts): a column for each check the event asks
 * (Paid with an entry fee, In TOM at a TOM event, List received from anyone
 * handing in a paper list), each with how many are ticked, and above the list
 * who is still open. An event the site pairs waits on them for round 1, so
 * each comes with what lets it go: marking them, or dropping them, one by one
 * or all at once. A long line of them is only counted there, and the roster's
 * Not checked in filter lists them (see rosterFilter), rather than the same
 * names twice. A TOM event pairs in TOM, so it gets the count, and a warning
 * if TOM's round 1 came in with anyone still open.
 *
 * Anyone TOM's file lists stands ticked In TOM, and that box is locked.
 *
 * Each tick and drop is saved on its own: only the box or button on its way
 * waits, so a desk working through a line never loses a click to another.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import { type CheckIn, type CheckMark, marksFor, notCheckedIn, openMarks } from '../../../shared/tournament/checkins';
import { hasStarted } from '../../../shared/tournament/rounds';
import { type Player, playerName } from '../../../shared/tournament/types';
import { fetchDecklists, type Manage, saveCheckIn } from '../../lib/tournament/api';
import { msg, t, tn } from '../../lib/i18n';
import { ConfirmAction } from './ConfirmAction';
import { OptionsMenu } from './OptionsMenu';
import type { ManageState } from './manageState';
import { registrantsSource, siteRegistrants } from './siteRegistrants';

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

/**
 * One event's check-in as the roster reads it, worked out once per answer: its
 * columns, and each player's check-in and checks. A tick hands the console a
 * new event, so a roster of a thousand asks this once and then reads a row at
 * a time, rather than walking every check-in in each row.
 */
interface CheckInView {
  columns: readonly CheckMark[];
  held: (id: string) => CheckIn | undefined;
  inTom: (id: string) => boolean;
  asks: (id: string, mark: CheckMark) => boolean;
}

const views = new WeakMap<Manage, CheckInView>();

function viewOf(manage: Manage): CheckInView {
  const seen = views.get(manage);
  if (seen) {
    return seen;
  }
  const held = checkins(manage);
  const anyPaper = Object.values(held).some(entry => entry.paper);
  const columns = marksFor(manage, anyPaper ? { paper: true } : undefined);
  // TOM answers In TOM for everyone in its file: one set, not a scan per cell.
  const inTom = manage.mode === 'tom' ? new Set(manage.tournament.players.map(player => player.id)) : null;
  const marks = new Map<string, CheckMark[]>();
  const standings = new Map<string, CheckIn | undefined>();
  const view: CheckInView = {
    columns,
    inTom: id => inTom?.has(id) ?? false,
    held: id => {
      if (!standings.has(id)) {
        const entry = held[id];
        standings.set(id, inTom?.has(id) ? { ...entry, tom: true } : entry);
      }
      return standings.get(id);
    },
    asks: (id, mark) => {
      let asked = marks.get(id);
      if (!asked) {
        asked = marksFor(manage, held[id]);
        marks.set(id, asked);
      }
      return asked.includes(mark);
    }
  };
  views.set(manage, view);
  return view;
}

/** A player's check-in as it stands, In TOM included for anyone TOM's file lists. */
const heldBy = (manage: Manage, id: string) => viewOf(manage).held(id);

/** Above this many players still open, the list above the roster is only counted. */
const LISTED_MAX = 10;

/** What is on its way, by player and check (or drop): only that control waits for its answer. */
const [saving, setSaving] = createSignal<ReadonlySet<string>>(new Set());
const keyOf = (playerId: string, what: CheckMark | 'drop') => `${playerId}|${what}`;
const isSaving = (playerId: string, what: CheckMark | 'drop') => saving().has(keyOf(playerId, what));

async function saved(key: string, request: () => Promise<boolean>): Promise<boolean> {
  setSaving(keys => new Set(keys).add(key));
  try {
    return await request();
  } finally {
    setSaving(keys => new Set([...keys].filter(held => held !== key)));
  }
}

/** Ticks or clears one check, through the console's state so the answer is the event shown. */
function tick(state: ManageState, code: string, check: { playerId: string; mark: CheckMark; on: boolean }) {
  return saved(keyOf(check.playerId, check.mark), () => state.run(() => saveCheckIn(code, check)));
}

/** Ticks or clears a box, answering with what it should show: what the event has once the server refused it, not the click. */
async function ticked(state: ManageState, manage: Manage, check: { playerId: string; mark: CheckMark; on: boolean }) {
  return (await tick(state, manage.code, check))
    ? check.on
    : checkins(state.data() ?? manage)[check.playerId]?.[check.mark] === true;
}

const drop = (state: ManageState, id: string) => saved(keyOf(id, 'drop'), () => state.send({ type: 'dropPlayer', id }));

/** Whether a player is still open in the event as the console has it now. */
function stillOpen(state: ManageState, player: Player): boolean {
  const manage = state.data();
  return manage !== null && notCheckedIn(manage, [player], checkins(manage)).length > 0;
}

/** While Drop all works through its list: its button waits for the last answer. */
const [droppingAll, setDroppingAll] = createSignal(false);

/**
 * Drops each player listed when staff confirmed, one after another, stopping
 * at the first the server refuses. Anyone checked in since is passed over.
 */
async function dropAll(state: ManageState, players: readonly Player[]) {
  setDroppingAll(true);
  try {
    for (const player of players) {
      if (stillOpen(state, player) && !(await drop(state, player.id))) {
        return;
      }
    }
  } finally {
    setDroppingAll(false);
  }
}

/** The checks the event asks of anyone, in column order: a list only once someone chose paper. */
export function checkColumns(manage: Manage): readonly CheckMark[] {
  return viewOf(manage).columns;
}

/** Whether the console shows check-in: before round 1, at an event that asks for any check. */
export const showsCheckIn = (manage: Manage) => !hasStarted(manage.tournament) && checkColumns(manage).length > 0;

export function CheckInHeads(props: { manage: Manage; players: readonly Player[] }) {
  const active = () => props.players.filter(player => player.droppedAfter === null);
  const ticked = (mark: CheckMark) => {
    const view = viewOf(props.manage);
    return active().filter(player => view.held(player.id)?.[mark]).length;
  };
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

/** One check's box for a player, saved on its own as it is ticked (see ticked); In TOM is locked for anyone TOM's file lists. */
function CheckBox(props: { state: ManageState; manage: Manage; id: string; name: string; mark: CheckMark }) {
  const held = () => heldBy(props.manage, props.id);
  const locked = () => props.mark === 'tom' && viewOf(props.manage).inTom(props.id);
  return (
    <label class='tm-check-cell'>
      <input
        type='checkbox'
        class='tm-check-box'
        checked={held()?.[props.mark] === true}
        disabled={locked() || isSaving(props.id, props.mark)}
        aria-label={`${t(MARK_LABELS[props.mark])}: ${props.name}`}
        onChange={e => {
          const box = e.currentTarget;
          const check = { playerId: props.id, mark: props.mark, on: box.checked };
          void ticked(props.state, props.manage, check).then(on => {
            box.checked = on;
          });
        }}
      />
      {/* The column's name, where a phone lays the row out without its head. */}
      <span class='tm-check-name' aria-hidden='true'>
        {t(MARK_LABELS[props.mark])}
      </span>
    </label>
  );
}

/** Whether the event asks `mark` of the player, as their own check-in stands. */
const asks = (manage: Manage, id: string, mark: CheckMark) => viewOf(manage).asks(id, mark);

export function CheckInCells(props: { state: ManageState; manage: Manage; id: string; name: string }) {
  return (
    <For each={checkColumns(props.manage)}>
      {mark => (
        <td class='tm-check-col'>
          <Show when={asks(props.manage, props.id, mark)}>
            <CheckBox {...props} mark={mark} />
          </Show>
        </td>
      )}
    </For>
  );
}

/** A player's checks in a line of their own, each named, as their sheet shows them. */
export function CheckInMarks(props: { state: ManageState; manage: Manage; id: string; name: string }) {
  return (
    <span class='tm-check-marks'>
      <For each={checkColumns(props.manage).filter(mark => asks(props.manage, props.id, mark))}>
        {mark => <CheckBox {...props} mark={mark} />}
      </For>
    </span>
  );
}

/** One player still open, with what lets them go under their menu, as a roster row's: the checks staff can mark here, or a drop. */
function Blocker(props: { state: ManageState; manage: Manage; player: Player }) {
  const name = () => playerName(props.player);
  return (
    <li>
      <span>{name()}</span>
      <OptionsMenu name={name()}>
        <For each={openMarks(props.manage, heldBy(props.manage, props.player.id))}>
          {mark => (
            <Show when={MARK_ACTIONS[mark]}>
              {label => (
                <button
                  type='button'
                  class='tm-menu-item'
                  data-closes-menu
                  disabled={isSaving(props.player.id, mark)}
                  onClick={() =>
                    void tick(props.state, props.manage.code, { playerId: props.player.id, mark, on: true })
                  }
                >
                  {t(label())}
                </button>
              )}
            </Show>
          )}
        </For>
        <ConfirmAction
          label={t('Drop')}
          question={t('Drop {name}? You can reinstate them until the next round is paired.', { name: name() })}
          class='tm-menu-item'
          danger
          disabled={isSaving(props.player.id, 'drop')}
          onConfirm={() => void drop(props.state, props.player.id)}
        />
      </OptionsMenu>
    </li>
  );
}

/**
 * Who still holds round 1 back: how many, a way to drop them all, and while
 * there are few, each with what lets them go.
 */
function Blockers(props: { state: ManageState; manage: Manage; open: readonly Player[] }) {
  const n = () => props.open.length;
  return (
    <div class='tm-box-bar tm-check-gate'>
      <div class='tm-check-head'>
        <strong>{n() === 1 ? t('1 player isn’t checked in.') : t('{n} players aren’t checked in.', { n: n() })}</strong>
        <Show when={n() > 1}>
          <ConfirmAction
            label={t('Drop all {n}', { n: n() })}
            question={tn(n(), 'Drop {n} player who isn’t checked in?', 'Drop {n} players who aren’t checked in?')}
            confirmLabel={t('Drop {n}', { n: n() })}
            danger
            disabled={droppingAll()}
            onConfirm={() => void dropAll(props.state, props.open)}
          />
        </Show>
      </div>
      <Show when={n() <= LISTED_MAX}>
        <ul class='tm-check-list'>
          <For each={props.open}>{player => <Blocker state={props.state} manage={props.manage} player={player} />}</For>
        </ul>
      </Show>
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

/**
 * Above the player list: who of `players` (everyone listed, site registrants
 * included) is still open, or at a TOM event how many, and a warning once TOM
 * paired them anyway.
 */
export function CheckInBox(props: { state: ManageState; manage: Manage; players: readonly Player[] }) {
  const open = () => notCheckedIn(props.manage, props.players, checkins(props.manage));
  const tom = () => props.manage.mode === 'tom';
  const asks = () => checkColumns(props.manage).length > 0;
  const total = () => props.players.filter(player => player.droppedAfter === null).length;
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
    () => registrantsSource(manage()),
    code => fetchDecklists(code)
  );
  return (): Player[] => siteRegistrants(manage(), lists.latest?.decklists ?? []);
}
