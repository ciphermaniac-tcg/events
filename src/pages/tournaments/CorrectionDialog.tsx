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
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { ApiError, correctResult, errorText, type Manage } from '../../lib/tournament/api';
import { type CorrectionPreview, correctionPreview } from '../../lib/tournament/corrections';
import { RESULT_WORDS } from '../../lib/tournament/present';
import { t, tx } from '../../lib/i18n';
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
      {tx('{before} to {after}', { before: <span class='muted'>{props.before}</span>, after: props.after })}
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
      <h4>{t('What changes')}</h4>
      <For each={props.preview.standings}>
        {group => (
          <>
            <Show when={group.division}>{division => <p class='tm-label'>{t(DIVISION_LABELS[division()])}</p>}</Show>
            <table class='tm-correction-diff'>
              <thead>
                <tr>
                  <th class='num'>#</th>
                  <th>{t('Player')}</th>
                  <th class='num'>{t('Record')}</th>
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
        <li>{t("Round {round}'s pairings stay as they are.", { round: props.round + 1 })}</li>
        <For each={props.preview.next.filter(m => m.points[0] !== m.points[1])}>
          {m => (
            <li>
              {t('Round {round} table {table} now pairs {p1} ({p1Points} pts) with {p2} ({p2Points} pts).', {
                round: props.round + 1,
                table: m.table,
                p1: name(m.p1),
                p1Points: m.points[0],
                p2: name(m.p2),
                p2Points: m.points[1]
              })}
            </li>
          )}
        </For>
        <li>{t('Round {round} pairs from the corrected standings.', { round: props.round + 2 })}</li>
      </ul>
    </div>
  );
}

const choicesFor = (match: Match, name: (id: string) => string): { value: Outcome; label: string }[] => [
  { value: 'p1', label: t('{name} won', { name: name(match.p1) }) },
  { value: 'p2', label: t('{name} won', { name: name(match.p2 ?? '') }) },
  { value: 'tie', label: t('Tie') },
  { value: 'double-loss', label: t('Double loss') }
];

export function CorrectionDialog(props: {
  manage: Manage;
  selection: CorrectionSelection;
  names: Map<string, string>;
  /** Who approves, as the console shows it: "Reese, organizer". */
  approving: string;
  onClose: () => void;
  onDone: (next: Manage) => void;
  /** The event changed since the preview: read it again, so the preview and the next try are of it as it stands. */
  onStale: () => void;
}) {
  // The dialog keeps the match it opened on, even if a poll replaces the event.
  const { pod: opened, round, match } = untrack(() => props.selection);
  const name = (id: string) => props.names.get(id) ?? id;
  const [outcome, setOutcome] = createSignal<Outcome>(match.outcome);
  const [note, setNote] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  // Under the note, where it is fixed; what the server says stays by the buttons.
  const [noteMissing, setNoteMissing] = createSignal(false);
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
      setNoteMissing(true);
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
      if (err instanceof ApiError && err.status === 409) {
        props.onStale();
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      title={t('Correct round {round}, table {table}', { round, table: match.table })}
      class='tm-correction'
      onClose={props.onClose}
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          void apply();
        }}
      >
        <div class='tm-box-bar tm-modal-body'>
          <div class='tm-correction-field'>
            <span>{t('Recorded {result}. Correct to', { result: t(RESULT_WORDS[match.outcome] ?? '') })}</span>
            <Segmented
              options={choicesFor(match, name)}
              selected={outcome()}
              onSelect={setOutcome}
              ariaLabel={t('Corrected result')}
            />
          </div>
          <div class='tm-correction-field'>
            <label for='correction-note'>{t('Note')}</label>
            <textarea
              id='correction-note'
              class='tm-input tm-textarea'
              rows={2}
              maxLength={CORRECTION_LIMITS.note}
              placeholder={t('Which slip, and what was wrong')}
              value={note()}
              aria-invalid={noteMissing() || undefined}
              aria-describedby={noteMissing() ? 'correction-note-error' : undefined}
              onInput={e => {
                setNote(e.currentTarget.value);
                setNoteMissing(false);
              }}
            />
            <Show when={noteMissing()}>
              <span id='correction-note-error' class='tm-problem' role='alert'>
                {t('Say which slip and what was wrong')}
              </span>
            </Show>
          </div>
          <p class='muted tm-correction-who'>{t('Approving as {who}', { who: props.approving })}</p>
          <Show
            when={preview()}
            fallback={<p class='muted tm-correction-who'>{t('Choose the corrected result to see what changes.')}</p>}
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
            {t('Cancel')}
          </button>
          <button type='submit' class='btn btn-primary' disabled={!changed() || saving()}>
            {t('Apply correction')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
