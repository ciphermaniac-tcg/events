/**
 * The console's next step at the end of a Swiss round: one button for the
 * step the plan suggests (pair the next round, start the top cut, end the
 * event) with a caret beside it that offers the others. Pairing happens at
 * once, since a round nobody has played can still be deleted; the top cut
 * asks its size and third-place match in a dialog, and ending asks first.
 */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { finalPodRound, prereleaseChoiceAvailable } from '../../../shared/tournament/lifecycleWorkflow';
import { latestRound } from '../../../shared/tournament/rounds';
import { TOP_CUT_SIZES } from '../../../shared/tournament/structure';
import { type Division, DIVISION_LABELS, type Pod } from '../../../shared/tournament/types';
import { type Manage, saveSettings } from '../../lib/tournament/api';
import { type DivisionCut, endGaps } from '../../lib/tournament/present';
import { Segmented } from '../../components/Segmented';
import type { ManageState } from './manageState';
import { Modal } from './Modal';
import { OptionsMenu } from './OptionsMenu';

/** Which of a Swiss round's ends the plan calls for: another round until its rounds are played, then the cut or the end. */
export type RoundEnd = 'pair' | 'cut' | 'end' | 'conclude';

const CUT_LABEL = 'Start top cut';
const END_LABEL = 'End event';

/** With no cut planned, the biggest one the players still in can fill, up to a top 8. */
const largestCut = (active: number) => TOP_CUT_SIZES.filter(n => n <= Math.min(8, active)).at(-1) ?? 2;

/** The size to offer first for a division: its planned cut, else the biggest it can fill. */
const suggestedCut = (entry: DivisionCut | undefined) => (entry ? entry.cut || largestCut(entry.active) : 2);

/**
 * The top cut's dialog: the division (when more than one is left to cut), the
 * size and the third-place match, then the button that starts it. `cuts` are
 * the divisions the pod plays that have yet to cut; in a pod of several
 * (`divided`) each cuts on its own.
 */
function CutDialog(props: {
  state: ManageState;
  pod: Pod;
  cuts: readonly DivisionCut[];
  divided: boolean;
  open: boolean;
  onClose: () => void;
}) {
  // eslint-disable-next-line solid/reactivity -- a starting suggestion; the organizer's pick wins from then on
  const [division, setDivision] = createSignal<Division>(props.cuts.at(-1)?.division ?? 'masters');
  const entry = () => props.cuts.find(c => c.division === division()) ?? props.cuts.at(-1);
  // A size picked stays with the division it was picked for; another division offers its own first.
  const [picked, setPicked] = createSignal<{ division: Division | undefined; size: number } | null>(null);
  const size = () => {
    const choice = picked();
    return choice && choice.division === entry()?.division ? choice.size : suggestedCut(entry());
  };
  const sizes = () =>
    TOP_CUT_SIZES.filter(n => n <= (entry()?.active ?? 0)).map(n => ({ value: String(n), label: `Top ${n}` }));
  // Optional, and announced before the cut starts; it needs two semifinal losers.
  const [thirdPlace, setThirdPlace] = createSignal(false);
  const playsThird = () => thirdPlace() && size() >= 4;
  function start() {
    const cut = {
      type: 'startTopCut' as const,
      pod: props.pod.category,
      size: size(),
      ...(playsThird() ? { playoff3rd4th: true } : {})
    };
    const which = entry()?.division;
    props.onClose();
    void props.state.send(props.divided && which ? { ...cut, division: which } : cut);
  }
  return (
    <Modal open={props.open} title='Start the top cut' class='tm-cut-dialog' onClose={props.onClose}>
      <div class='tm-box-bar tm-modal-body'>
        <div class='tm-cut-row'>
          <span class='tm-cut-label'>Cut to</span>
          <Show when={props.cuts.length > 1}>
            <select
              class='tm-select'
              aria-label='Division to cut'
              onChange={e => setDivision(e.currentTarget.value as Division)}
            >
              <For each={props.cuts}>
                {c => (
                  <option value={c.division} selected={c.division === entry()?.division}>
                    {DIVISION_LABELS[c.division]}
                  </option>
                )}
              </For>
            </select>
          </Show>
          <Segmented
            options={sizes()}
            selected={String(size())}
            onSelect={value => setPicked({ division: entry()?.division, size: Number(value) })}
            ariaLabel='Top cut size'
          />
        </div>
        <Show when={size() >= 4}>
          <label class='tm-check'>
            <input type='checkbox' checked={thirdPlace()} onChange={e => setThirdPlace(e.currentTarget.checked)} />
            Third place match
          </label>
        </Show>
      </div>
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={() => props.onClose()}>
          Cancel
        </button>
        <button type='button' class='btn btn-primary' disabled={props.state.busy()} onClick={start}>
          Start top {size()} cut
        </button>
      </div>
    </Modal>
  );
}

/**
 * Ending the event, asked in a dialog after a review of what it would leave
 * unplayed (see endGaps): with nothing left it ends as planned, and with
 * anything left the dialog lists it and the event ends early. Results change
 * only by reopening it afterwards.
 */
function EndDialog(props: { state: ManageState; manage: Manage; open: boolean; onClose: () => void }) {
  const gaps = createMemo(() => (props.open ? endGaps(props.manage) : []));
  const early = () => gaps().length > 0;
  function end() {
    const { code } = props.manage;
    props.onClose();
    void props.state.run(() => saveSettings(code, { finished: true }));
  }
  return (
    <Modal
      open={props.open}
      title={early() ? 'End the event early?' : 'End the event?'}
      class='tm-end-dialog'
      onClose={props.onClose}
    >
      <div class='tm-box-bar tm-modal-body'>
        <Show when={early()}>
          <ul class='tm-end-gaps'>
            <For each={gaps()}>
              {gap => (
                <li>
                  <Show when={gap.where}>{where => <strong>{where()}: </strong>}</Show>
                  {gap.detail}
                </li>
              )}
            </For>
          </ul>
        </Show>
        <p class='muted'>The final standings are published. Results can change only by reopening the event.</p>
      </div>
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={() => props.onClose()}>
          Keep running
        </button>
        <button
          type='button'
          class={early() ? 'btn btn-secondary tm-danger' : 'btn btn-primary'}
          disabled={props.state.busy()}
          onClick={end}
        >
          {early() ? 'End early' : END_LABEL}
        </button>
      </div>
    </Modal>
  );
}

/** The end-the-event button alone, as the step once a champion is known. */
export function EndEventStep(props: { state: ManageState; manage: Manage; primary?: boolean }) {
  const [asking, setAsking] = createSignal(false);
  return (
    <>
      <button
        type='button'
        class={props.primary === false ? 'btn btn-secondary' : 'btn btn-primary'}
        disabled={props.state.busy()}
        onClick={() => setAsking(true)}
      >
        {END_LABEL}
      </button>
      <EndDialog state={props.state} manage={props.manage} open={asking()} onClose={() => setAsking(false)} />
    </>
  );
}

const CARET = (
  <svg viewBox='0 0 12 12' width='12' height='12' aria-hidden='true'>
    <path d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='currentColor' stroke-width='1.6' />
  </svg>
);

/**
 * The suggested step as a button, and a caret offering the other steps the
 * event can take: the next Swiss round (until the cut has begun), the top cut
 * (a Cup with a division left to cut) and ending the event.
 */
export function RoundEndSplit(props: {
  state: ManageState;
  manage: Manage;
  pod: Pod;
  /** The pairing step's label, as "Pair round 4". */
  label: string;
  step: RoundEnd;
  cuts: readonly DivisionCut[];
  /** Whether a top cut can be offered at all (see ManageEvent). */
  canCut: boolean;
  swissOver: boolean;
}) {
  const [dialog, setDialog] = createSignal<'cut' | 'end' | null>(null);
  const open = () => props.cuts.filter(c => !c.started);
  const allDone = () =>
    props.manage.tournament.pods.every(pod => {
      const round = latestRound(pod);
      return round && finalPodRound(props.manage.tournament, pod, round);
    });
  const steps = (): { end: RoundEnd; label: string }[] => [
    ...(props.swissOver || props.pod.prereleaseConcluded ? [] : [{ end: 'pair' as const, label: props.label }]),
    ...(prereleaseChoiceAvailable(props.manage.tournament, props.pod)
      ? [{ end: 'conclude' as const, label: 'Conclude pod' }]
      : []),
    ...(props.canCut ? [{ end: 'cut' as const, label: CUT_LABEL }] : []),
    ...(props.manage.tournament.settings?.mode !== 'PRERELEASE' || allDone()
      ? [{ end: 'end' as const, label: END_LABEL }]
      : [])
  ];
  const main = () =>
    steps().find(s => s.end === props.step) ?? steps()[0] ?? { end: 'conclude' as const, label: 'Pod concluded' };
  const others = () => steps().filter(s => s.end !== main().end);
  const take = (end: RoundEnd) => {
    if (end === 'pair') {
      void props.state.send({ type: 'pairRound', pod: props.pod.category });
    } else if (end === 'conclude') {
      void props.state.send({ type: 'concludePrerelease', pod: props.pod.category });
    } else {
      setDialog(end);
    }
  };
  return (
    <span class='tm-split'>
      <button
        type='button'
        class='btn btn-primary'
        disabled={props.state.busy() || steps().length === 0}
        onClick={() => take(main().end)}
      >
        {main().label}
      </button>
      <Show when={others().length > 0}>
        <OptionsMenu
          name='the next step'
          buttonClass='btn btn-primary tm-split-caret'
          buttonLabel='Other next steps'
          buttonContent={CARET}
          closeOnSelect
          busy={props.state.busy()}
        >
          <For each={others()}>
            {s => (
              <button type='button' class='tm-menu-item' onClick={() => take(s.end)}>
                {s.label}
              </button>
            )}
          </For>
        </OptionsMenu>
      </Show>
      <Show when={props.canCut}>
        <CutDialog
          state={props.state}
          pod={props.pod}
          cuts={open()}
          divided={props.cuts.length > 1}
          open={dialog() === 'cut'}
          onClose={() => setDialog(null)}
        />
      </Show>
      <EndDialog state={props.state} manage={props.manage} open={dialog() === 'end'} onClose={() => setDialog(null)} />
    </span>
  );
}
