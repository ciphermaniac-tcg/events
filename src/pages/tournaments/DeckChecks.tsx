/**
 * Deck checks in the console's Decklists tab (see shared/tournament/deckChecks.ts).
 * Each list's row says the player's latest check; opening the row shows the
 * list beside every check of that player's deck and a form to record one:
 * the round, who checked, pass or fail, and notes. Editing a check records
 * a new version of it and removing one records its removal, so each says
 * who wrote it down and when, with its earlier versions a click away.
 */

import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import {
  DECK_CHECK_LIMITS,
  type DeckCheck,
  type DeckCheckEntry,
  type DeckCheckResult,
  standingChecks
} from '../../../shared/tournament/deckChecks';
import {
  type DeckCheckRecord,
  errorText,
  fetchDeckChecks,
  recordDeckCheck,
  removeDeckCheck
} from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { Segmented } from '../../components/Segmented';
import { ConfirmAction } from './ConfirmAction';

/** The event's deck check record, read once for the tab and replaced by each write's answer. */
export function createDeckChecks(code: () => string) {
  const [record, { refetch, mutate }] = createResource(code, fetchDeckChecks);
  const standing = createMemo(() => standingChecks(latestValue(record)?.entries ?? []));
  return {
    code,
    /** A player's checks as they stand, the latest round first. */
    of: (playerId: string) =>
      standing()
        .filter(check => check.playerId === playerId)
        .sort((a, b) => b.round - a.round || b.recordedAt - a.recordedAt),
    checkers: () => latestValue(record)?.checkers ?? [],
    loading: () => record.loading && !latestValue(record),
    failed: () => Boolean(record.error),
    retry: () => void refetch(),
    take: (next: DeckCheckRecord) => mutate(next)
  };
}

export type DeckChecks = ReturnType<typeof createDeckChecks>;

const RESULT_WORDS: Record<DeckCheckResult, string> = { pass: 'Pass', fail: 'Fail' };

const timeOf = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const nameOr = (name: string | null) => name ?? 'Deleted account';

function Result(props: { result: DeckCheckResult }) {
  return <strong class={`tm-check-${props.result}`}>{RESULT_WORDS[props.result]}</strong>;
}

/** The row's cell: the player's latest check, or that there is none. */
export function LastCheck(props: { checks: DeckChecks; playerId: string | undefined }) {
  const last = () => (props.playerId ? props.checks.of(props.playerId)[0] : undefined);
  return (
    <Show
      when={last()}
      fallback={<span class='muted-cell'>{props.checks.loading() || props.checks.failed() ? '' : 'Not checked'}</span>}
    >
      {check => (
        <span class='tm-nowrap'>
          R{check().round} <Result result={check().result} />
        </span>
      )}
    </Show>
  );
}

/** An earlier version of a check, in one line. */
function Earlier(props: { entry: DeckCheckEntry }) {
  return (
    <li>
      R{props.entry.round} · {RESULT_WORDS[props.entry.result]} · {nameOr(props.entry.checker.name)}
      {props.entry.notes ? ` · ${props.entry.notes}` : ''} · {nameOr(props.entry.recordedBy)},{' '}
      {timeOf(props.entry.recordedAt)}
    </li>
  );
}

/** One check: its round, result and checker, its notes, who wrote it down when, and its earlier versions. */
function CheckLine(props: { check: DeckCheck; onEdit: () => void; onRemove: () => void }) {
  const [older, setOlder] = createSignal(false);
  const earlier = () => props.check.earlier.length;
  return (
    <li>
      <div class='tm-check-head'>
        <span>
          <strong>R{props.check.round}</strong> · <Result result={props.check.result} /> · checked by{' '}
          {nameOr(props.check.checker.name)}
        </span>
        <span class='tm-grow' />
        <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onEdit()}>
          Edit
        </button>
        <ConfirmAction
          label='Remove'
          question='Remove this deck check?'
          confirmLabel='Remove'
          danger
          onConfirm={() => props.onRemove()}
        />
      </div>
      <Show when={props.check.notes}>{notes => <p class='tm-check-notes'>{notes()}</p>}</Show>
      <p class='tm-check-meta muted'>
        {earlier() ? 'Edited' : 'Recorded'} by {nameOr(props.check.recordedBy)} at {timeOf(props.check.recordedAt)}
        <Show when={earlier()}>
          {' · '}
          <button
            type='button'
            class='btn btn-ghost tm-small'
            aria-expanded={older()}
            onClick={() => setOlder(!older())}
          >
            {older() ? 'Hide' : 'Show'} {earlier()} earlier version{earlier() === 1 ? '' : 's'}
          </button>
        </Show>
      </p>
      <Show when={older()}>
        <ul class='tm-check-earlier muted'>
          <For each={props.check.earlier}>{entry => <Earlier entry={entry} />}</For>
        </ul>
      </Show>
    </li>
  );
}

/** Someone not on the staff, by a name typed in: the checker select's last choice. */
const SOMEONE_ELSE = '';

interface Draft {
  round: number;
  checkerId: string;
  checkerName: string;
  result: DeckCheckResult | null;
  notes: string;
  /** The check this edits; null for a new one. */
  replaces: string | null;
}

const fresh = (round: number, me: string | null): Draft => ({
  round,
  checkerId: me ?? SOMEONE_ELSE,
  checkerName: '',
  result: null,
  notes: '',
  replaces: null
});

const editing = (check: DeckCheck): Draft => ({
  round: check.round,
  checkerId: check.checker.id ?? SOMEONE_ELSE,
  checkerName: check.checker.id ? '' : (check.checker.name ?? ''),
  result: check.result,
  notes: check.notes,
  replaces: check.id
});

/** What is missing before the draft can be saved, or null. */
function draftProblem(draft: Draft): string | null {
  if (!draft.result) {
    return 'Choose Pass or Fail';
  }
  return draft.checkerId === SOMEONE_ELSE && !draft.checkerName.trim() ? 'Say who checked the deck' : null;
}

interface FormProps {
  draft: Draft;
  latestRound: number;
  checkers: { id: string; name: string }[];
  saving: boolean;
  error: string | null;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}

function CheckForm(props: FormProps) {
  function set(change: Partial<Draft>) {
    props.onChange({ ...props.draft, ...change });
  }
  /** Every round paired so far, the latest first. */
  const rounds = () => {
    const latest = props.latestRound;
    return Array.from({ length: latest }, (_, i) => latest - i);
  };
  return (
    <form
      class='tm-check-form'
      onSubmit={event => {
        event.preventDefault();
        props.onSave();
      }}
    >
      <label>
        Round
        <select
          class='tm-select'
          value={props.draft.round}
          onChange={e => set({ round: Number(e.currentTarget.value) })}
        >
          <For each={rounds()}>{round => <option value={round}>Round {round}</option>}</For>
        </select>
      </label>
      <label>
        Deck checker
        <select
          class='tm-select'
          value={props.draft.checkerId}
          onChange={e => set({ checkerId: e.currentTarget.value })}
        >
          <For each={props.checkers}>{checker => <option value={checker.id}>{checker.name}</option>}</For>
          <option value={SOMEONE_ELSE}>Someone else</option>
        </select>
      </label>
      <Show when={props.draft.checkerId === SOMEONE_ELSE}>
        <label>
          Name
          <input
            class='tm-input'
            maxLength={DECK_CHECK_LIMITS.checkerName}
            value={props.draft.checkerName}
            onInput={e => set({ checkerName: e.currentTarget.value })}
          />
        </label>
      </Show>
      <div class='tm-check-field'>
        <span>Result</span>
        <Segmented
          options={(['pass', 'fail'] as const).map(value => ({
            value,
            label: <span class={`tm-check-${value}`}>{RESULT_WORDS[value]}</span>
          }))}
          selected={props.draft.result}
          onSelect={result => set({ result })}
          ariaLabel='Result'
        />
      </div>
      <label class='tm-check-wide'>
        Notes
        <textarea
          class='tm-input tm-textarea'
          rows={3}
          maxLength={DECK_CHECK_LIMITS.notes}
          value={props.draft.notes}
          onInput={e => set({ notes: e.currentTarget.value })}
        />
      </label>
      <div class='tm-check-wide tm-row-actions'>
        <button type='submit' class='btn btn-primary tm-small' disabled={props.saving}>
          {props.draft.replaces ? 'Save edit' : 'Save check'}
        </button>
        <Show when={props.draft.replaces}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onCancel()}>
            Cancel
          </button>
        </Show>
        <Show when={props.error}>
          {error => (
            <span class='tm-problem' role='alert'>
              {error()}
            </span>
          )}
        </Show>
      </div>
    </form>
  );
}

interface SideProps {
  checks: DeckChecks;
  playerId: string;
  /** The latest round the player's division has paired (see latestRoundOf); 0 before round 1. */
  latestRound: number;
  /** The signed-in staff account, the checker a new check starts with. */
  me: string | null;
}

/** The opened row's side: the player's checks, and the form that records or edits one. */
export function DeckCheckSide(props: SideProps) {
  // eslint-disable-next-line solid/reactivity -- a new check starts at the round paired when the row opened
  const [draft, setDraft] = createSignal(fresh(props.latestRound, props.me));
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const reset = () => {
    setDraft(fresh(props.latestRound, props.me));
    setError(null);
  };
  /** Sends a write and takes its answer; the form starts again only if it still holds what `done` says was written. */
  async function write(request: () => Promise<DeckCheckRecord>, done: (now: Draft) => boolean) {
    setSaving(true);
    setError(null);
    try {
      props.checks.take(await request());
      if (done(draft())) {
        reset();
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }
  function remove(id: string) {
    const code = props.checks.code();
    void write(
      () => removeDeckCheck(code, id),
      now => now.replaces === id
    );
  }
  function save() {
    const sent = draft();
    const { round, checkerId, checkerName, result, notes, replaces } = sent;
    const problem = draftProblem(sent);
    if (problem || !result) {
      setError(problem);
      return;
    }
    const checker = checkerId === SOMEONE_ELSE ? { checkerName } : { checkerId };
    const check = { playerId: props.playerId, round, result, notes, replaces, ...checker };
    const code = props.checks.code();
    void write(
      () => recordDeckCheck(code, check),
      now => now === sent
    );
  }
  return (
    <div class='tm-check-side'>
      <h4>Deck checks</h4>
      <Show
        when={!props.checks.failed()}
        fallback={
          <p class='muted'>
            Deck checks could not be loaded.{' '}
            <button type='button' class='btn btn-secondary tm-small' onClick={() => props.checks.retry()}>
              Retry
            </button>
          </p>
        }
      >
        <Show
          when={props.checks.of(props.playerId).length}
          fallback={<p class='muted'>{props.checks.loading() ? 'Loading deck checks…' : 'No deck checks yet.'}</p>}
        >
          <ul class='tm-check-list'>
            <For each={props.checks.of(props.playerId)}>
              {check => (
                <CheckLine check={check} onEdit={() => setDraft(editing(check))} onRemove={() => remove(check.id)} />
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <Show when={props.latestRound > 0} fallback={<p class='muted'>Checks are recorded once round 1 is paired.</p>}>
        <h4>{draft().replaces ? 'Edit check' : 'Record a check'}</h4>
        <CheckForm
          draft={draft()}
          latestRound={props.latestRound}
          checkers={props.checks.checkers()}
          saving={saving()}
          error={error()}
          onChange={setDraft}
          onSave={save}
          onCancel={reset}
        />
      </Show>
    </div>
  );
}
