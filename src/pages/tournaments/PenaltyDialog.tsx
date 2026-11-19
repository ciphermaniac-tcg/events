/**
 * A penalty noted from a table's menu (see RoundPanel): the dialog knows the
 * table, so it asks which of its two players, then the penalty, the judge and
 * notes, as the Penalties tab does (see PenaltiesPanel). A Game Loss, Match
 * Loss or Disqualification at a table still playing also records the loss,
 * through the table's own result entry, once the note is saved. What was
 * submitted holds while the note is on its way: the controls wait, and the
 * loss goes to the seat the note names, only while the table is still
 * playing (see resultEntry).
 */

import { createResource, createSignal, For, Show, untrack } from 'solid-js';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import {
  DECIDING_PENALTIES,
  isPenalty,
  PENALTIES,
  type Penalty,
  PENALTY_LABELS,
  PENALTY_NOTE_LIMITS
} from '../../../shared/tournament/penaltyNotes';
import type { Match, Outcome } from '../../../shared/tournament/types';
import { errorText, fetchPenaltyNotes, recordPenaltyNote } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { t } from '../../lib/i18n';
import { ErrorLine, Field } from './Field';
import { Modal } from './Modal';
import { session } from './session';

export interface PenaltySelection {
  round: number;
  match: Match;
  /** Records the table's result, while it is still playing and its results are entered here; refused once it is not. */
  record?: (outcome: Outcome) => void;
}

/** The judge select's last choice: someone not on the staff, by a name typed in. */
const SOMEONE_ELSE = '';

/** What is missing before the note can be saved, or null. */
function problem(penalty: Penalty | '', judgeId: string, judgeName: string): string | null {
  if (!penalty) {
    return t('Choose a penalty');
  }
  return judgeId === SOMEONE_ELSE && !judgeName.trim() ? t('Say which judge gave it') : null;
}

export function PenaltyDialog(props: {
  code: string;
  selection: PenaltySelection;
  names: Map<string, string>;
  onClose: () => void;
}) {
  // The dialog keeps the table it opened on, even if a poll replaces the round.
  const { round, match, record } = untrack(() => props.selection);
  const [judges] = createResource(() => props.code, fetchPenaltyNotes);
  const [playerId, setPlayerId] = createSignal(match.p1);
  const [penalty, setPenalty] = createSignal<Penalty | ''>('');
  const [judgeId, setJudgeId] = createSignal(latestValue(session)?.user?.id ?? SOMEONE_ELSE);
  const [judgeName, setJudgeName] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const name = (id: string | null) => (id ? (props.names.get(id) ?? id) : '');
  const records = () => record !== undefined && penalty() !== '' && DECIDING_PENALTIES.has(penalty() as Penalty);
  async function save() {
    const missing = problem(penalty(), judgeId(), judgeName());
    const chosen = penalty();
    if (missing || !chosen) {
      setError(missing);
      return;
    }
    const judge = judgeId() === SOMEONE_ELSE ? { judgeName: judgeName() } : { judgeId: judgeId() };
    // Taken as pressed: the seat and the loss stand for the note, whatever the controls do on its way.
    const [player, decides] = [playerId(), records()];
    setSaving(true);
    setError(null);
    try {
      await recordPenaltyNote(props.code, {
        playerId: player,
        round,
        penalty: chosen,
        notes: notes(),
        replaces: null,
        ...judge
      });
      if (decides) {
        record?.(player === match.p1 ? 'p2' : 'p1');
      }
      props.onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open title={t('Penalty, table {table}', { table: match.table })} onClose={props.onClose}>
      <form
        onSubmit={event => {
          event.preventDefault();
          void save();
        }}
      >
        <div class='tm-box-bar tm-modal-body'>
          <div class='tm-field'>
            <span class='tm-label'>{t('Player')}</span>
            <Segmented
              options={[match.p1, match.p2 ?? ''].map(id => ({ value: id, label: name(id) }))}
              selected={playerId()}
              onSelect={id => saving() || setPlayerId(id)}
              ariaLabel={t('Player')}
            />
          </div>
          <Field id='penalty-kind' label={t('Penalty')}>
            <select
              id='penalty-kind'
              class='tm-select'
              disabled={saving()}
              value={penalty()}
              onChange={e => setPenalty(isPenalty(e.currentTarget.value) ? e.currentTarget.value : '')}
            >
              <option value=''>{t('Choose a penalty')}</option>
              <For each={PENALTIES}>{p => <option value={p}>{t(PENALTY_LABELS[p])}</option>}</For>
            </select>
          </Field>
          <Field id='penalty-judge' label={t('Judge')}>
            <select
              id='penalty-judge'
              class='tm-select'
              disabled={saving()}
              value={judgeId()}
              onChange={e => setJudgeId(e.currentTarget.value)}
            >
              <For each={latestValue(judges)?.judges ?? []}>{j => <option value={j.id}>{j.name}</option>}</For>
              <option value={SOMEONE_ELSE}>{t('Someone else')}</option>
            </select>
          </Field>
          <Show when={judgeId() === SOMEONE_ELSE}>
            <Field id='penalty-judge-name' label={t('Name')}>
              <input
                id='penalty-judge-name'
                class='tm-input'
                disabled={saving()}
                maxLength={PENALTY_NOTE_LIMITS.judgeName}
                value={judgeName()}
                onInput={e => setJudgeName(e.currentTarget.value)}
              />
            </Field>
          </Show>
          <Field id='penalty-notes' label={t('Notes')}>
            <input
              id='penalty-notes'
              class='tm-input'
              disabled={saving()}
              maxLength={PENALTY_NOTE_LIMITS.notes}
              value={notes()}
              onInput={e => setNotes(e.currentTarget.value)}
            />
          </Field>
          <ErrorLine message={error()} />
        </div>
        <div class='tm-box-bar tm-modal-foot'>
          <button type='button' class='btn btn-ghost' onClick={() => props.onClose()}>
            {t('Cancel')}
          </button>
          <button type='submit' class='btn btn-primary' disabled={saving()}>
            {records() ? t('Save and record the loss') : t('Save note')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
