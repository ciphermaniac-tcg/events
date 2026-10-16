/**
 * The console's Penalties tab (see shared/tournament/penaltyNotes.ts): a log
 * of every penalty note staff wrote down, newest round first, with the form
 * that records one above it. A note issues nothing; a Game Loss, Match Loss
 * or Disqualification is entered on the results or the roster as ever. Deck
 * checks can be read in among the notes, so the head judge has one record.
 * Editing a note records a new version of it and removing one records its
 * removal, so each says who wrote it down and when.
 */

import { createMemo, createResource, createSignal, For, type JSX, Show } from 'solid-js';
import { type DeckCheckEntry, standingChecks } from '../../../shared/tournament/deckChecks';
import {
  DECIDING_PENALTIES,
  isPenalty,
  PENALTIES,
  type Penalty,
  PENALTY_LABELS,
  PENALTY_NOTE_LIMITS,
  type PenaltyNote,
  type PenaltyNoteEntry,
  standingNotes
} from '../../../shared/tournament/penaltyNotes';
import { latestRoundOf } from '../../../shared/tournament/staffRecords';
import type { Player } from '../../../shared/tournament/types';
import {
  errorText,
  fetchDeckChecks,
  fetchPenaltyNotes,
  type Manage,
  type PenaltyNoteRecord,
  recordPenaltyNote,
  removePenaltyNote
} from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { intlLocale, t, tn, tx } from '../../lib/i18n';
import { Segmented } from '../../components/Segmented';
import { ConfirmAction } from './ConfirmAction';
import { session } from './session';

const timeOf = (at: number) => new Date(at).toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' });

const nameOr = (name: string | null) => name ?? t('Deleted account');

const fullName = (player: Pick<Player, 'firstName' | 'lastName'>) => `${player.firstName} ${player.lastName}`;

/** Someone not on the staff, by a name typed in: the judge select's last choice. */
const SOMEONE_ELSE = '';

interface Draft {
  playerId: string;
  round: number;
  judgeId: string;
  judgeName: string;
  penalty: Penalty | '';
  notes: string;
  /** The note this edits; null for a new one. */
  replaces: string | null;
}

const fresh = (round: number, me: string | null): Draft => ({
  playerId: '',
  round,
  judgeId: me ?? SOMEONE_ELSE,
  judgeName: '',
  penalty: '',
  notes: '',
  replaces: null
});

const editing = (note: PenaltyNote): Draft => ({
  playerId: note.playerId,
  round: note.round,
  judgeId: note.judge.id ?? SOMEONE_ELSE,
  judgeName: note.judge.id ? '' : (note.judge.name ?? ''),
  penalty: note.penalty,
  notes: note.notes,
  replaces: note.id
});

/** What is missing before the draft can be saved, or null. */
function draftProblem(draft: Draft): string | null {
  if (!draft.playerId) {
    return t('Choose a player');
  }
  if (!draft.penalty) {
    return t('Choose a penalty');
  }
  return draft.judgeId === SOMEONE_ELSE && !draft.judgeName.trim() ? t('Say which judge gave it') : null;
}

/** One line of the log: a penalty note, or with deck checks shown, a deck check. */
type Line = { kind: 'note'; note: PenaltyNote } | { kind: 'check'; check: DeckCheckEntry };

const roundOf = (line: Line) => (line.kind === 'note' ? line.note.round : line.check.round);
const atOf = (line: Line) => (line.kind === 'note' ? line.note.recordedAt : line.check.recordedAt);

/** The words a search looks through on a line: the player, the penalty or check, the judge, and the notes. */
function wordsOf(line: Line): string {
  if (line.kind === 'note') {
    const { note } = line;
    return [note.playerName, t(PENALTY_LABELS[note.penalty]), note.judge.name ?? '', note.notes].join(' ');
  }
  const { check } = line;
  return [check.playerName, t('deck check'), check.result, check.checker.name ?? '', check.notes].join(' ');
}

const linesOf = (notes: PenaltyNote[], checks: DeckCheckEntry[]): Line[] =>
  [
    ...notes.map(note => ({ kind: 'note' as const, note })),
    ...checks.map(check => ({ kind: 'check' as const, check }))
  ].sort((a, b) => roundOf(b) - roundOf(a) || atOf(b) - atOf(a));

function Select(props: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: JSX.Element;
}) {
  return (
    <label>
      {props.label}
      <select class='tm-select' value={props.value} onChange={e => props.onChange(e.currentTarget.value)}>
        {props.children}
      </select>
    </label>
  );
}

const rounds = (latest: number) => Array.from({ length: latest }, (_, i) => latest - i);

interface FormProps {
  draft: Draft;
  players: Player[];
  latestOf: (playerId: string) => number;
  judges: { id: string; name: string }[];
  saving: boolean;
  error: string | null;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}

function NoteForm(props: FormProps) {
  const set = (change: Partial<Draft>) => props.onChange({ ...props.draft, ...change });
  const setPlayer = (playerId: string) =>
    set({ playerId, round: Math.min(props.draft.round, props.latestOf(playerId)) || props.draft.round });
  return (
    <form
      class='tm-penalty-form'
      onSubmit={event => {
        event.preventDefault();
        props.onSave();
      }}
    >
      <Select label={t('Player')} value={props.draft.playerId} onChange={setPlayer}>
        <option value=''>{t('Choose a player')}</option>
        <For each={props.players}>{player => <option value={player.id}>{fullName(player)}</option>}</For>
      </Select>
      <Select label={t('Round')} value={props.draft.round} onChange={value => set({ round: Number(value) })}>
        <For each={rounds(props.latestOf(props.draft.playerId))}>
          {round => <option value={round}>{t('Round {round}', { round })}</option>}
        </For>
      </Select>
      <Select
        label={t('Penalty')}
        value={props.draft.penalty}
        onChange={value => set({ penalty: isPenalty(value) ? value : '' })}
      >
        <option value=''>{t('Choose a penalty')}</option>
        <For each={PENALTIES}>{penalty => <option value={penalty}>{t(PENALTY_LABELS[penalty])}</option>}</For>
      </Select>
      <Select label={t('Judge')} value={props.draft.judgeId} onChange={judgeId => set({ judgeId })}>
        <For each={props.judges}>{judge => <option value={judge.id}>{judge.name}</option>}</For>
        <option value={SOMEONE_ELSE}>{t('Someone else')}</option>
      </Select>
      <Show when={props.draft.judgeId === SOMEONE_ELSE}>
        <label>
          {t('Name')}
          <input
            class='tm-input'
            maxLength={PENALTY_NOTE_LIMITS.judgeName}
            value={props.draft.judgeName}
            onInput={e => set({ judgeName: e.currentTarget.value })}
          />
        </label>
      </Show>
      <label class='tm-penalty-notes'>
        {t('Notes')}
        <input
          class='tm-input'
          maxLength={PENALTY_NOTE_LIMITS.notes}
          value={props.draft.notes}
          onInput={e => set({ notes: e.currentTarget.value })}
        />
      </label>
      <span class='tm-row-actions tm-penalty-save'>
        <button type='submit' class='btn btn-primary' disabled={props.saving}>
          {props.draft.replaces ? t('Save edit') : t('Save note')}
        </button>
        <Show when={props.draft.replaces}>
          <button type='button' class='btn btn-ghost' onClick={() => props.onCancel()}>
            {t('Cancel')}
          </button>
        </Show>
      </span>
      <Show when={props.draft.penalty !== '' && DECIDING_PENALTIES.has(props.draft.penalty as Penalty)}>
        <p class='muted tm-penalty-wide'>{t('A note only. Enter the result or disqualification yourself.')}</p>
      </Show>
      <Show when={props.error}>
        {error => (
          <p class='tm-problem tm-penalty-wide' role='alert'>
            {error()}
          </p>
        )}
      </Show>
    </form>
  );
}

/** A note's earlier versions, in one line each. */
function Earlier(props: { note: PenaltyNote }) {
  const [open, setOpen] = createSignal(false);
  const count = () => props.note.earlier.length;
  return (
    <Show when={count()}>
      <button type='button' class='btn btn-ghost tm-small' aria-expanded={open()} onClick={() => setOpen(!open())}>
        {open()
          ? tn(count(), 'Hide {n} earlier version', 'Hide {n} earlier versions')
          : tn(count(), 'Show {n} earlier version', 'Show {n} earlier versions')}
      </button>
      <Show when={open()}>
        <ul class='tm-check-earlier muted'>
          <For each={props.note.earlier}>
            {(entry: PenaltyNoteEntry) => (
              <li>
                R{entry.round} · {t(PENALTY_LABELS[entry.penalty])} · {nameOr(entry.judge.name)}
                {entry.notes ? ` · ${entry.notes}` : ''} · {nameOr(entry.recordedBy)}, {timeOf(entry.recordedAt)}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Show>
  );
}

function PenaltyWord(props: { penalty: Penalty }) {
  return (
    <strong class={DECIDING_PENALTIES.has(props.penalty) ? 'tm-penalty-deciding' : undefined}>
      {t(PENALTY_LABELS[props.penalty])}
    </strong>
  );
}

function NoteRow(props: { note: PenaltyNote; onEdit: () => void; onRemove: () => void }) {
  return (
    <tr>
      <td class='num tm-table-col'>{props.note.round}</td>
      <td class='tm-penalty-player'>{props.note.playerName}</td>
      <td class='tm-penalty-what'>
        <PenaltyWord penalty={props.note.penalty} />
      </td>
      <td class='tm-penalty-judge'>{nameOr(props.note.judge.name)}</td>
      <td class='tm-penalty-text'>
        {props.note.notes}
        <Earlier note={props.note} />
      </td>
      <td class='muted-cell tm-penalty-when'>
        {nameOr(props.note.recordedBy)}, {timeOf(props.note.recordedAt)}
      </td>
      <td class='tm-extra-col'>
        <span class='tm-row-actions'>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onEdit()}>
            {t('Edit')}
          </button>
          <ConfirmAction
            label={t('Remove')}
            question={t('Remove this penalty note?')}
            confirmLabel={t('Remove')}
            danger
            onConfirm={() => props.onRemove()}
          />
        </span>
      </td>
    </tr>
  );
}

function CheckRow(props: { check: DeckCheckEntry }) {
  return (
    <tr>
      <td class='num tm-table-col'>{props.check.round}</td>
      <td class='tm-penalty-player'>{props.check.playerName}</td>
      <td class='tm-penalty-what'>
        {tx('Deck check {result}', {
          result: (
            <strong class={`tm-check-${props.check.result}`}>
              {props.check.result === 'pass' ? t('Pass') : t('Fail')}
            </strong>
          )
        })}
      </td>
      <td class='tm-penalty-judge'>{nameOr(props.check.checker.name)}</td>
      <td class='tm-penalty-text'>{props.check.notes}</td>
      <td class='muted-cell tm-penalty-when'>
        {nameOr(props.check.recordedBy)}, {timeOf(props.check.recordedAt)}
      </td>
      <td class='tm-extra-col' />
    </tr>
  );
}

function Log(props: { lines: Line[]; onEdit: (note: PenaltyNote) => void; onRemove: (id: string) => void }) {
  return (
    <div class='table-wrap'>
      <table class='data tm-penalty-log'>
        <thead>
          <tr>
            <th class='num tm-table-col'>{t('Rd')}</th>
            <th>{t('Player')}</th>
            <th>{t('Penalty')}</th>
            <th>{t('Judge')}</th>
            <th>{t('Notes')}</th>
            <th>{t('Recorded')}</th>
            <th>
              <span class='sr-only'>{t('Actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.lines}>
            {line =>
              line.kind === 'note' ? (
                <NoteRow
                  note={line.note}
                  onEdit={() => props.onEdit(line.note)}
                  onRemove={() => props.onRemove(line.note.id)}
                />
              ) : (
                <CheckRow check={line.check} />
              )
            }
          </For>
        </tbody>
      </table>
    </div>
  );
}

type Shown = 'notes' | 'checks';

function Filters(props: {
  query: string;
  onQuery: (query: string) => void;
  round: number;
  latest: number;
  onRound: (round: number) => void;
  withChecks: boolean;
  shown: Shown;
  onShown: (shown: Shown) => void;
}) {
  return (
    <div class='tm-box-bar'>
      <input
        class='search'
        type='search'
        placeholder={t('Player, penalty or judge')}
        aria-label={t('Search penalty notes')}
        value={props.query}
        onInput={e => props.onQuery(e.currentTarget.value)}
      />
      <select
        class='tm-select tm-penalty-round'
        aria-label={t('Round')}
        value={props.round}
        onChange={e => props.onRound(Number(e.currentTarget.value))}
      >
        <option value={0}>{t('All rounds')}</option>
        <For each={rounds(props.latest)}>{round => <option value={round}>{t('Round {round}', { round })}</option>}</For>
      </select>
      <Show when={props.withChecks}>
        <span class='tm-grow' />
        <Segmented
          options={[
            { value: 'notes', label: t('Penalties') },
            { value: 'checks', label: t('With deck checks') }
          ]}
          selected={props.shown}
          onSelect={props.onShown}
          ariaLabel={t('Show')}
        />
      </Show>
    </div>
  );
}

/** The event's penalty note record, read once for the tab and replaced by each write's answer. */
function createPenaltyNotes(code: () => string) {
  const [record, { refetch, mutate }] = createResource(code, fetchPenaltyNotes);
  const standing = createMemo(() => standingNotes(latestValue(record)?.entries ?? []));
  return {
    standing,
    judges: () => latestValue(record)?.judges ?? [],
    loading: () => record.loading && !latestValue(record),
    failed: () => Boolean(record.error),
    retry: () => void refetch(),
    take: (next: PenaltyNoteRecord) => mutate(next)
  };
}

function LogState(props: {
  failed: boolean;
  loading: boolean;
  empty: string | null;
  onRetry: () => void;
  children: JSX.Element;
}) {
  return (
    <Show
      when={!props.failed}
      fallback={
        <p class='muted tm-empty'>
          {t('Penalty notes could not be loaded.')}{' '}
          <button type='button' class='btn btn-secondary tm-small' onClick={() => props.onRetry()}>
            {t('Retry')}
          </button>
        </p>
      }
    >
      <Show when={!props.loading} fallback={<p class='muted tm-empty'>{t('Loading penalty notes…')}</p>}>
        <Show when={props.empty === null} fallback={<p class='muted tm-empty'>{props.empty}</p>}>
          {props.children}
        </Show>
      </Show>
    </Show>
  );
}

export function PenaltiesPanel(props: { manage: Manage }) {
  const notes = createPenaltyNotes(() => props.manage.code);
  const me = () => latestValue(session)?.user?.id ?? null;
  const latestOf = (playerId: string) => latestRoundOf(props.manage.tournament, playerId);
  const latest = createMemo(() => Math.max(0, ...props.manage.tournament.players.map(player => latestOf(player.id))));
  // A player is only written up for a round they were paired in; a late entry waits for their first.
  const players = createMemo(() =>
    props.manage.tournament.players
      .filter(player => latestOf(player.id) > 0)
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
  );

  const [draft, setDraft] = createSignal(fresh(latest(), me()));
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal('');
  const [round, setRound] = createSignal(0);
  const [shown, setShown] = createSignal<Shown>('notes');
  const withChecks = () => props.manage.settings.decklists !== 'off';
  const [checks, { refetch: retryChecks }] = createResource(
    () => (withChecks() && shown() === 'checks' ? props.manage.code : false),
    code => fetchDeckChecks(code).then(record => standingChecks(record.entries))
  );
  // Built apart from the filters, so a row that stays through a search is the same row, opened as it was.
  const all = createMemo(() => linesOf(notes.standing(), shown() === 'checks' ? (latestValue(checks) ?? []) : []));
  const lines = createMemo(() => {
    const words = query().trim().toLowerCase();
    return all().filter(
      line => (round() === 0 || roundOf(line) === round()) && wordsOf(line).toLowerCase().includes(words)
    );
  });
  const reset = () => {
    setDraft(fresh(latest(), me()));
    setError(null);
  };
  /** Sends a write and takes its answer; the form starts again only if it still holds what `done` says was written. */
  async function write(request: () => Promise<PenaltyNoteRecord>, done: (now: Draft) => boolean) {
    setSaving(true);
    setError(null);
    try {
      notes.take(await request());
      if (done(draft())) {
        reset();
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }
  function save() {
    const sent = draft();
    const { playerId, round: when, judgeId, judgeName, penalty, notes: text, replaces } = sent;
    const problem = draftProblem(sent);
    if (problem || !penalty) {
      setError(problem);
      return;
    }
    const judge = judgeId === SOMEONE_ELSE ? { judgeName } : { judgeId };
    const note = { playerId, round: when, penalty, notes: text, replaces, ...judge };
    const { code } = props.manage;
    void write(
      () => recordPenaltyNote(code, note),
      now => now === sent
    );
  }
  return (
    <div class='tm-panel'>
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>{draft().replaces ? t('Edit note') : t('Record a penalty')}</strong>
          <span class='muted'>{t('Staff only')}</span>
        </div>
        <div class='tm-box-bar'>
          <NoteForm
            draft={draft()}
            players={players()}
            latestOf={id => (id ? latestOf(id) : latest())}
            judges={notes.judges()}
            saving={saving()}
            error={error()}
            onChange={setDraft}
            onSave={save}
            onCancel={reset}
          />
        </div>
      </section>
      <section class='tm-box'>
        <Filters
          query={query()}
          onQuery={setQuery}
          round={round()}
          latest={latest()}
          onRound={setRound}
          withChecks={withChecks()}
          shown={shown()}
          onShown={setShown}
        />
        <Show when={shown() === 'checks' && checks.error}>
          <p class='muted tm-empty'>
            {t('Deck checks could not be loaded.')}{' '}
            <button type='button' class='btn btn-secondary tm-small' onClick={() => void retryChecks()}>
              {t('Retry')}
            </button>
          </p>
        </Show>
        <LogState
          failed={notes.failed()}
          loading={notes.loading()}
          empty={lines().length ? null : notes.standing().length ? t('No notes match.') : t('No penalty notes yet.')}
          onRetry={notes.retry}
        >
          <Log
            lines={lines()}
            onEdit={note => {
              setDraft(editing(note));
              setError(null);
            }}
            onRemove={id => {
              const { code } = props.manage;
              void write(
                () => removePenaltyNote(code, id),
                now => now.replaces === id
              );
            }}
          />
        </LogState>
      </section>
    </div>
  );
}
