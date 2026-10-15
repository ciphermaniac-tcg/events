/**
 * Result corrections in the console's Pairings tab (see
 * shared/tournament/corrections.ts). A round before the latest says whether
 * it can still be corrected; while it can, the organizer or head judge opens
 * a table's menu for Correct result (CorrectionDialog), and the round's
 * corrections are listed under its tables, each with who approved it, when,
 * and the note it was made with.
 */

import { createResource, createSignal, For, type JSX, lazy, Show, Suspense } from 'solid-js';
import { type CorrectionContext, type CorrectionEntry, roundRefusal } from '../../../shared/tournament/corrections';
import type { Match, Pod, Round } from '../../../shared/tournament/types';
import { type CorrectionRecord, fetchCorrections, type Manage } from '../../lib/tournament/api';
import { RESULT_WORDS } from '../../lib/tournament/present';
import { latestValue } from '../../lib/resource';
import type { CorrectionSelection } from './CorrectionDialog';
import { ExtensionClock } from './ExtensionClock';
import { OptionsMenu } from './OptionsMenu';
import { session } from './session';

// Corrections are rare, so the dialog loads when one is first opened.
const CorrectionDialog = lazy(() => import('./CorrectionDialog').then(m => ({ default: m.CorrectionDialog })));

const ROLE_WORDS = { organizer: 'organizer', 'head-judge': 'head judge' } as const;

const timeOf = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Who approved a correction, as what, and whether alone. */
export function approvalLine(entry: Pick<CorrectionEntry, 'approvedBy' | 'role' | 'alone'>): string {
  const who = entry.approvedBy ?? 'Deleted account';
  return `${who}, ${ROLE_WORDS[entry.role]}${entry.alone ? ' (no head judge named)' : ''}`;
}

/**
 * What the note above a past round says: when it can be corrected and by
 * whom, or why it cannot. Null for the plain read-only note, as for a round
 * of a top cut.
 */
export function pastNote(pod: Pod, round: Round, ctx: CorrectionContext, approver: boolean): string | null {
  if (round.kind !== 'swiss') {
    return null;
  }
  const refusal = roundRefusal(pod, round.number, ctx);
  if (refusal) {
    return refusal;
  }
  const until = `Round ${round.number} can be corrected until round ${round.number + 2} is paired`;
  return approver ? `${until}.` : `${until}, by the organizer or head judge.`;
}

/** A past round's result cell: whether it was corrected, and how to correct it now, if the viewer can. */
export interface CorrectableCell {
  corrected: boolean;
  onCorrect: (() => void) | null;
}

/** A past round's result, with Correct result in its menu while the round can be corrected. */
export function CorrectableResult(props: { match: Match; round: Round; cell: CorrectableCell }) {
  return (
    <div class='tm-result'>
      <span class='tm-result-label'>
        {RESULT_WORDS[props.match.outcome]}
        <Show when={props.cell.corrected}>
          <span class='tm-flag'>Corrected</span>
        </Show>
        <ExtensionClock match={props.match} round={props.round} playing={false} />
      </span>
      <Show when={props.cell.onCorrect}>
        {correct => (
          <span class='tm-result-acts'>
            <OptionsMenu name={`table ${String(props.match.table)}`} closeOnSelect>
              <button type='button' class='tm-menu-item' onClick={() => correct()()}>
                Correct result
              </button>
            </OptionsMenu>
          </span>
        )}
      </Show>
    </div>
  );
}

/** A past round's corrections, newest first, under its tables. */
function CorrectionLog(props: { entries: CorrectionEntry[]; names: Map<string, string> }) {
  const name = (id: string) => props.names.get(id) ?? id;
  return (
    <Show when={props.entries.length}>
      <div class='tm-box-bar'>
        <strong>Corrections</strong>
      </div>
      <ul class='tm-corrections'>
        <For each={props.entries}>
          {entry => (
            <li>
              <span>
                <strong>Table {entry.table}</strong> · {name(entry.p1)} v {name(entry.p2)} · {RESULT_WORDS[entry.from]}{' '}
                to {RESULT_WORDS[entry.to]}
              </span>
              <span>{entry.note}</span>
              <span class='muted'>
                Approved by {approvalLine(entry)} at {timeOf(entry.recordedAt)}, during round {entry.during}
              </span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

/** The event's corrections and the viewer's part in them, read while `shown` holds, and again as the event changes. */
function createRecord(manage: () => Manage, shown: () => boolean) {
  const [record] = createResource(
    () => (shown() ? { code: manage().code, version: manage().version } : false),
    ({ code }) => fetchCorrections(code)
  );
  return (): CorrectionRecord | undefined => latestValue(record);
}

/** What the round panel hands its corrections: the event, the pod shown, and whether nothing can be entered. */
interface PanelProps {
  manage: Manage;
  pod: Pod;
  locked?: boolean;
}

/**
 * Corrections for the round panel: the note over a past round, each result's
 * cell, the round's corrections under its tables, and the dialog. `past` is
 * the past round shown, by name; null on the latest round.
 */
export function createRoundCorrections(props: PanelProps, past: () => string | null) {
  const tom = () => props.manage.mode === 'tom';
  const ctx = () => ({
    tom: tom(),
    finished: props.manage.settings.finished,
    paired: props.manage.pairedThrough ?? {}
  });
  const record = createRecord(
    () => props.manage,
    () => past() !== null && !tom()
  );
  const approver = () => record()?.approver ?? null;
  const [correcting, setCorrecting] = createSignal<CorrectionSelection | null>(null);
  const entries = (round: Round) =>
    (record()?.corrections ?? []).filter(e => e.pod === props.pod.category && e.round === round.number);
  /** Whether the viewer can correct the round now: past, in the window, and theirs to approve. */
  const open = (round: Round) =>
    approver() !== null &&
    !props.locked === true &&
    round.kind === 'swiss' &&
    !roundRefusal(props.pod, round.number, ctx());
  const approving = () =>
    approvalLine({
      approvedBy: latestValue(session)?.user?.name ?? null,
      role: approver() ?? 'organizer',
      alone: approver() === 'organizer' && record()?.headJudge === null
    });
  return {
    note: (round: Round | undefined) =>
      round && past() ? pastNote(props.pod, round, ctx(), approver() !== null) : null,
    cell: (match: Match, round: Round): CorrectableCell | null =>
      past() === null || tom() || round.kind !== 'swiss'
        ? null
        : {
            corrected: entries(round).some(e => e.table === match.table && e.p1 === match.p1),
            onCorrect: open(round) ? () => setCorrecting({ pod: props.pod, round: round.number, match }) : null
          },
    log: (round: Round, names: Map<string, string>): JSX.Element => (
      <Show when={past()}>
        <CorrectionLog entries={entries(round)} names={names} />
      </Show>
    ),
    dialog: (names: Map<string, string>, onDone: (next: Manage) => void): JSX.Element => (
      <Show when={correcting()} keyed>
        {selection => (
          <Suspense>
            <CorrectionDialog
              manage={props.manage}
              selection={selection}
              names={names}
              approving={approving()}
              onClose={() => setCorrecting(null)}
              onDone={next => {
                setCorrecting(null);
                onDone(next);
              }}
            />
          </Suspense>
        )}
      </Show>
    )
  };
}
