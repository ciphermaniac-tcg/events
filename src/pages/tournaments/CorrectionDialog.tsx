/**
 * Correcting a past round's result (see Corrections.tsx): the result it
 * should have, a note saying which slip and what was wrong, and before
 * anything is sent, every standing it changes and the next round's matches
 * that now pair players on different points. The correction goes on the
 * event as previewed: if the event changes first, the server refuses it and
 * the preview reads the event again.
 */

import { createMemo, createSignal, For, Show, untrack } from 'solid-js';
import { CORRECTION_LIMITS } from '../../../shared/tournament/corrections';
import { percentLabel, recordLabel, type Standing } from '../../../shared/tournament/standings';
import { DIVISION_LABELS, type Match, type Outcome, type Pod } from '../../../shared/tournament/types';
import { Segmented } from '../../components/Segmented';
import { correctResult, errorText, type Manage } from '../../lib/tournament/api';
import { type CorrectionPreview, correctionPreview } from '../../lib/tournament/corrections';
import { RESULT_WORDS } from '../../lib/tournament/present';
import { Modal } from './Modal';

export interface CorrectionSelection {
  pod: Pod;
  round: number;
  match: Match;
}

/** A value that moved, as it was and as it would be; the one value when it did not. */
function Moved(props: { before: string; after: string }) {
  return (
    <Show when={props.before !== props.after} fallback={props.after}>
      <span class='muted'>{props.before}</span> to {props.after}
    </Show>
  );
}

function Changes(props: { preview: CorrectionPreview; names: Map<string, string>; round: number }) {
  const name = (id: string) => props.names.get(id) ?? id;
  const row = (before: Standing, after: Standing) => (
    <tr>
      <td class='num'>
        <Moved before={String(before.place)} after={String(after.place)} />
      </td>
      <td>{name(after.playerId)}</td>
      <td class='num'>
        <Moved before={recordLabel(before.record)} after={recordLabel(after.record)} />
      </td>
      <td class='num'>
        <Moved before={percentLabel(before.owp)} after={percentLabel(after.owp)} />
      </td>
    </tr>
  );
  return (
    <div class='tm-correction-changes'>
      <h4>What changes</h4>
      <For each={props.preview.standings}>
        {group => (
          <>
            <Show when={group.division}>{division => <p class='tm-label'>{DIVISION_LABELS[division()]}</p>}</Show>
            <table class='tm-correction-diff'>
              <thead>
                <tr>
                  <th class='num'>#</th>
                  <th>Player</th>
                  <th class='num'>Record</th>
                  <th class='num'>OWP</th>
                </tr>
              </thead>
              <tbody>
                <For each={group.changes}>{change => row(change.before, change.after)}</For>
              </tbody>
            </table>
          </>
        )}
      </For>
      <ul class='tm-correction-lines'>
        <li>Round {props.round + 1}'s pairings stay as they are.</li>
        <For each={props.preview.next.filter(m => m.points[0] !== m.points[1])}>
          {m => (
            <li>
              Round {props.round + 1} table {m.table} now pairs {name(m.p1)} ({m.points[0]} pts) with {name(m.p2)} (
              {m.points[1]} pts).
            </li>
          )}
        </For>
        <li>Round {props.round + 2} pairs from the corrected standings.</li>
      </ul>
    </div>
  );
}

const choicesFor = (match: Match, name: (id: string) => string): { value: Outcome; label: string }[] => [
  { value: 'p1', label: `${name(match.p1)} won` },
  { value: 'p2', label: `${name(match.p2 ?? '')} won` },
  { value: 'tie', label: 'Tie' },
  { value: 'double-loss', label: 'Double loss' }
];

export function CorrectionDialog(props: {
  manage: Manage;
  selection: CorrectionSelection;
  names: Map<string, string>;
  /** Who approves, as the console shows it: "Reese, organizer". */
  approving: string;
  onClose: () => void;
  onDone: (next: Manage) => void;
}) {
  // The dialog keeps the match it opened on, even if a poll replaces the event.
  const { pod: opened, round, match } = untrack(() => props.selection);
  const name = (id: string) => props.names.get(id) ?? id;
  const [outcome, setOutcome] = createSignal<Outcome>(match.outcome);
  const [note, setNote] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const changed = () => outcome() !== match.outcome;
  // Read against the event as it stands now, so the preview is what the server is sent.
  const pod = () => props.manage.tournament.pods.find(p => p.category === opened.category) ?? opened;
  const preview = createMemo(() =>
    changed()
      ? correctionPreview(props.manage.tournament, pod(), {
          pod: opened.category,
          round,
          table: match.table,
          p1: match.p1,
          p2: match.p2 ?? '',
          outcome: outcome()
        })
      : null
  );
  async function apply() {
    if (!note().trim()) {
      setError('Say which slip and what was wrong');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const request = {
        pod: opened.category,
        round,
        table: match.table,
        p1: match.p1,
        p2: match.p2 ?? '',
        outcome: outcome(),
        note: note(),
        version: props.manage.version
      };
      props.onDone(await correctResult(props.manage.code, request));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open title={`Correct round ${round}, table ${match.table}`} class='tm-correction' onClose={props.onClose}>
      <form
        onSubmit={event => {
          event.preventDefault();
          void apply();
        }}
      >
        <div class='tm-box-bar tm-modal-body'>
          <div class='tm-correction-field'>
            <span>Recorded {RESULT_WORDS[match.outcome]}. Correct to</span>
            <Segmented
              options={choicesFor(match, name)}
              selected={outcome()}
              onSelect={setOutcome}
              ariaLabel='Corrected result'
            />
          </div>
          <label class='tm-correction-field'>
            Note
            <textarea
              class='tm-input tm-textarea'
              rows={2}
              maxLength={CORRECTION_LIMITS.note}
              placeholder='Which slip, and what was wrong'
              value={note()}
              onInput={e => setNote(e.currentTarget.value)}
            />
          </label>
          <p class='muted tm-correction-who'>Approving as {props.approving}</p>
          <Show
            when={preview()}
            fallback={<p class='muted tm-correction-who'>Choose the corrected result to see what changes.</p>}
          >
            {p => <Changes preview={p()} names={props.names} round={round} />}
          </Show>
        </div>
        <div class='tm-box-bar tm-modal-foot'>
          <Show when={error()}>
            {message => (
              <span class='tm-problem' role='alert'>
                {message()}
              </span>
            )}
          </Show>
          <button type='button' class='btn btn-ghost' onClick={() => props.onClose()}>
            Cancel
          </button>
          <button type='submit' class='btn btn-primary' disabled={!changed() || saving()}>
            Apply correction
          </button>
        </div>
      </form>
    </Modal>
  );
}
