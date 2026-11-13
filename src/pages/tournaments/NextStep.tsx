/**
 * The console's next step at the end of a Swiss round: one button for the
 * step the plan suggests (pair the next round, start the top cut, end the
 * event) with a caret beside it that offers the others. Pairing happens at
 * once, since a round nobody has played can still be deleted, unless a drop
 * request is open (see dropGate); the top cut asks its size in a dialog that
 * names who it takes, and ending, or concluding a Prerelease pod, asks first.
 */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { finalPodRound, prereleaseChoiceAvailable } from '../../../shared/tournament/lifecycleWorkflow';
import { divisionLookup } from '../../../shared/tournament/divisions';
import { latestRound, regularRounds } from '../../../shared/tournament/rounds';
import { recordLabel, swissStandings } from '../../../shared/tournament/standings';
import { eventTypeOf, TOP_CUT_SIZES } from '../../../shared/tournament/structure';
import { type Division, DIVISION_LABELS, type Pod } from '../../../shared/tournament/types';
import { type Manage, saveSettings } from '../../lib/tournament/api';
import { type DivisionCut, namesById, podLabel } from '../../lib/tournament/present';
import { cutSplit, endGaps } from '../../lib/tournament/staff';
import { ordinal } from '../../lib/format';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { Icon } from '@ciphermaniac/design/components/Icon';
import { ConfirmDialog } from './ConfirmAction';
import type { ManageState } from './manageState';
import { Modal } from './Modal';
import { createDropGate } from './dropGate';
import { OptionsMenu } from './OptionsMenu';
import { msg, t } from '../../lib/i18n';

/** Which of a Swiss round's ends the plan calls for: another round until its rounds are played, then the cut or the end. */
export type RoundEnd = 'pair' | 'cut' | 'end' | 'conclude';

const CUT_LABEL = msg('Start top cut');
const END_LABEL = msg('End event');

/** With no cut planned, the biggest one the players still in can fill, up to a top 8. */
const largestCut = (active: number) => TOP_CUT_SIZES.filter(n => n <= Math.min(8, active)).at(-1) ?? 2;

/** The size to offer first for a division: its planned cut, else the biggest it can fill. */
const suggestedCut = (entry: DivisionCut | undefined) => (entry ? entry.cut || largestCut(entry.active) : 2);

/**
 * Who a cut of `size` takes from a division, as the cut seeds it: the players
 * still in, by Swiss place in each flight, the flights taking turns. In a pod
 * of one flight, `out` is the first left out and `why` what put the last one
 * in above them; `all` says nobody still in is left out.
 */
function cutPreview(manage: Manage, pod: Pod, division: Division, size: number) {
  const of = divisionLookup(manage.tournament);
  const flights = pod.flights ?? [{ number: 1, playerIds: pod.playerIds }];
  const per = size / flights.length;
  const ranked = flights.map(flight =>
    swissStandings(pod, manage.tournament.players, {
      only: new Set(flight.playerIds.filter(id => of(id) === division)),
      regularRounds: regularRounds(manage.tournament, pod),
      noRecord: new Set(pod.lostRecords)
    }).filter(row => !row.dropped)
  );
  const seeds = Array.from({ length: per }, (_, index) => ranked.flatMap(rows => rows.slice(index, index + 1)));
  const single = ranked.length === 1 ? ranked[0]! : null;
  return {
    seeds: seeds.flat(),
    out: single?.[size] ?? null,
    why: single && cutSplit(single, size),
    all: ranked.every(rows => rows.length <= per)
  };
}

/** The seeds the size picked takes, and the bubble, before anything is committed. */
function CutPreview(props: { manage: Manage; pod: Pod; division: Division; size: number }) {
  const preview = createMemo(() => cutPreview(props.manage, props.pod, props.division, props.size));
  const names = createMemo(() => namesById(props.manage.tournament));
  const bubble = () => {
    const { out, why, all } = preview();
    if (all) {
      return t('Everyone still in makes this cut.');
    }
    if (!out) {
      return '';
    }
    const line = t('{place} {name} {record} is out', {
      place: ordinal(props.size + 1),
      name: names().get(out.playerId) ?? out.playerId,
      record: recordLabel(out.record)
    });
    return why ? `${line} · ${why}` : line;
  };
  return (
    <div class='tm-cut-preview'>
      <p class='tm-cut-preview-head'>
        <span>{t('The {n} in this cut', { n: preview().seeds.length })}</span>
        <span class='num'>{bubble()}</span>
      </p>
      <ol class='tm-cut-seeds'>
        <For each={preview().seeds}>
          {(row, index) => (
            <li>
              <span class='muted num'>{index() + 1}</span>
              <span class='tm-name'>{names().get(row.playerId) ?? row.playerId}</span>
              <span class='muted num'>{recordLabel(row.record)}</span>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}

/**
 * The top cut's dialog: the division (when more than one is left to cut) and
 * the size, who that takes, then the button that starts it. `cuts` are the
 * divisions the pod plays that have yet to cut; in a pod of several
 * (`divided`) each cuts on its own.
 */
function CutDialog(props: {
  state: ManageState;
  manage: Manage;
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
    TOP_CUT_SIZES.filter(n => n <= (entry()?.active ?? 0)).map(n => ({ value: String(n), label: t('Top {n}', { n }) }));
  function start() {
    const cut = { type: 'startTopCut' as const, pod: props.pod.category, size: size() };
    const which = entry()?.division;
    props.onClose();
    void props.state.send(props.divided && which ? { ...cut, division: which } : cut);
  }
  return (
    <Modal open={props.open} title={t('Start the top cut')} class='tm-cut-dialog' onClose={props.onClose}>
      <div class='tm-box-bar tm-modal-body'>
        <div class='tm-cut-row'>
          <span class='tm-cut-label'>{t('Cut to')}</span>
          <Show when={props.cuts.length > 1}>
            <select
              class='tm-select'
              aria-label={t('Division to cut')}
              onChange={e => setDivision(e.currentTarget.value as Division)}
            >
              <For each={props.cuts}>
                {c => (
                  <option value={c.division} selected={c.division === entry()?.division}>
                    {t(DIVISION_LABELS[c.division])}
                  </option>
                )}
              </For>
            </select>
          </Show>
          <Segmented
            options={sizes()}
            selected={String(size())}
            onSelect={value => setPicked({ division: entry()?.division, size: Number(value) })}
            ariaLabel={t('Top cut size')}
          />
        </div>
        <Show when={entry()}>
          {cut => <CutPreview manage={props.manage} pod={props.pod} division={cut().division} size={size()} />}
        </Show>
      </div>
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={() => props.onClose()}>
          {t('Cancel')}
        </button>
        <button type='button' class='btn btn-primary' disabled={props.state.busy()} onClick={start}>
          {t('Start top {n} cut', { n: size() })}
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
      title={early() ? t('End the event early?') : t('End the event?')}
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
        <p class='muted'>{t('The final standings are published. Results can change only by reopening the event.')}</p>
      </div>
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={() => props.onClose()}>
          {t('Keep running')}
        </button>
        <button
          type='button'
          class={early() ? 'btn btn-secondary tm-danger' : 'btn btn-primary'}
          disabled={props.state.busy()}
          onClick={end}
        >
          {early() ? t('End early') : t(END_LABEL)}
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
        {t(END_LABEL)}
      </button>
      <EndDialog state={props.state} manage={props.manage} open={asking()} onClose={() => setAsking(false)} />
    </>
  );
}

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
  /** The pod's divisions have begun their top cuts: its Swiss rounds are over, and only the others' cuts are left. */
  swissOver: boolean;
}) {
  const [dialog, setDialog] = createSignal<Exclude<RoundEnd, 'pair'> | null>(null);
  const gate = createDropGate({
    state: () => props.state,
    manage: () => props.manage,
    pod: () => props.pod
  });
  const open = () => props.cuts.filter(c => !c.started);
  // A League Challenge plays Swiss rounds only.
  const canCut = () =>
    !props.pod.prereleaseConcluded &&
    eventTypeOf(props.manage.tournament) !== 'challenge' &&
    (props.step === 'cut' || open().some(c => c.active >= 4));
  const allDone = () =>
    props.manage.tournament.pods.every(pod => {
      const round = latestRound(pod);
      return round && finalPodRound(props.manage.tournament, pod, round);
    });
  const steps = (): { end: RoundEnd; label: string }[] => [
    ...(props.swissOver || props.pod.prereleaseConcluded ? [] : [{ end: 'pair' as const, label: props.label }]),
    ...(prereleaseChoiceAvailable(props.manage.tournament, props.pod)
      ? [{ end: 'conclude' as const, label: t('Conclude pod') }]
      : []),
    ...(canCut() ? [{ end: 'cut' as const, label: t(CUT_LABEL) }] : []),
    ...(props.manage.tournament.settings?.mode !== 'PRERELEASE' || allDone()
      ? [{ end: 'end' as const, label: t(END_LABEL) }]
      : [])
  ];
  const main = () =>
    steps().find(s => s.end === props.step) ?? steps()[0] ?? { end: 'conclude' as const, label: t('Pod concluded') };
  const others = () => steps().filter(s => s.end !== main().end);
  const take = (end: RoundEnd) => {
    if (end === 'pair') {
      gate.pair();
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
          name={t('the next step')}
          buttonClass='btn btn-primary tm-split-caret'
          buttonLabel={t('Other next steps')}
          buttonContent={<Icon name='chevron-down' />}
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
      <Show when={canCut()}>
        <CutDialog
          state={props.state}
          manage={props.manage}
          pod={props.pod}
          cuts={open()}
          divided={props.cuts.length > 1}
          open={dialog() === 'cut'}
          onClose={() => setDialog(null)}
        />
      </Show>
      <EndDialog state={props.state} manage={props.manage} open={dialog() === 'end'} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={dialog() === 'conclude'}
        question={
          props.manage.tournament.pods.length > 1
            ? t('Conclude the {pod} pod?', { pod: podLabel(props.pod) })
            : t('Conclude this pod?')
        }
        scope={t('It pairs no more rounds. Only ending and reopening the event undoes this.')}
        confirmLabel={t('Conclude')}
        keepLabel={t('Keep running')}
        danger
        busy={props.state.busy()}
        onConfirm={() => void props.state.send({ type: 'concludePrerelease', pod: props.pod.category })}
        onClose={() => setDialog(null)}
      />
      {gate.dialog(props.label)}
    </span>
  );
}
