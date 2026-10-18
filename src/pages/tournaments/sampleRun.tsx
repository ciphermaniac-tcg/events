/**
 * The home page's sample event as it plays: one run of the engine's rounds
 * (lib/tournament/sampleEvent), stepped a result at a time in the order a
 * room reports them (lib/tournament/sampleSchedule), which every preview on
 * the page reads. A new event opens already paired, so nothing on the page
 * ever stands empty between events. Under reduced motion it shows the
 * finished event, at rest.
 */

import { batch, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { seededRandom, shuffled } from '../../../shared/tournament/random';
import {
  playSampleEvent,
  reportOrder,
  SAMPLE_PLAYERS,
  type SampleStanding,
  sampleStandings,
  type SampleTable
} from '../../lib/tournament/sampleEvent';
import { type SampleStep, scheduleRounds } from '../../lib/tournament/sampleSchedule';

export const SAMPLE_ROUNDS = 5;
/** The player the phone and the profile follow. */
export const SAMPLE_FOCUS = 'Reese Lundquist';
/** The page's pace: a result a beat, a read between rounds, a rest at the end. */
const TIMING = { beat: 320, read: 1600, rest: 4500 };

interface Run {
  players: string[];
  rounds: SampleTable[][];
  orders: number[][];
}

function newRun(): Run {
  const random = seededRandom(Date.now() % 100_000);
  const players = shuffled(SAMPLE_PLAYERS, random);
  const rounds = playSampleEvent(players, SAMPLE_ROUNDS, random);
  return { players, rounds, orders: rounds.map(tables => reportOrder(tables, random)) };
}

export interface SampleRun {
  players: () => readonly string[];
  /** The round being played, from 1. */
  round: () => number;
  tables: () => readonly SampleTable[];
  /** Whether table `index` (from 0) of this round has reported. */
  reported: (index: number) => boolean;
  /** How many of this round's tables have reported. */
  reportedCount: () => number;
  standings: () => readonly SampleStanding[];
  /** A player's line and place (from 0). */
  standingOf: (name: string) => { line: SampleStanding; place: number } | undefined;
  finished: () => boolean;
}

/** Applies the schedule's steps on timers, and starts the next event when one ends. */
function useClockwork(set: {
  run: (run: Run) => void;
  round: (n: number) => void;
  landed: (n: number) => void;
  finished: (done: boolean) => void;
}) {
  let timers: number[] = [];
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  function apply(step: SampleStep) {
    if (step.kind === 'round') {
      batch(() => {
        set.round(step.round);
        set.landed(0);
      });
    } else if (step.kind === 'landed') {
      set.landed(step.landed);
    } else if (step.kind === 'finished') {
      set.finished(true);
    } else {
      play(newRun());
    }
  }
  function play(run: Run) {
    stop();
    batch(() => {
      set.run(run);
      set.round(1);
      set.landed(0);
      set.finished(false);
    });
    for (const step of scheduleRounds(run.rounds, TIMING)) {
      timers.push(window.setTimeout(() => apply(step), step.at));
    }
  }
  return { play, stop };
}

export function createSampleRun(): SampleRun {
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const first = newRun();
  const [run, setRun] = createSignal(first);
  const [round, setRound] = createSignal(still ? SAMPLE_ROUNDS : 1);
  const [landed, setLanded] = createSignal(still ? (first.rounds.at(-1)?.length ?? 0) : 0);
  const [finished, setFinished] = createSignal(still);

  const tables = () => run().rounds[round() - 1] ?? [];
  const order = () => run().orders[round() - 1] ?? [];
  const reported = (index: number) => {
    const at = order().indexOf(index);
    return at >= 0 && at < landed();
  };
  const results = createMemo(() => [
    ...run()
      .rounds.slice(0, round() - 1)
      .flat(),
    ...order()
      .slice(0, landed())
      .map(i => tables()[i])
      .filter((table): table is SampleTable => table !== undefined)
  ]);
  const standings = createMemo(() => sampleStandings(run().players, results()));
  const places = createMemo(() => new Map(standings().map((line, place) => [line.name, { line, place }])));

  onMount(() => {
    if (still) {
      return;
    }
    const clockwork = useClockwork({ run: setRun, round: setRound, landed: setLanded, finished: setFinished });
    clockwork.play(first);
    onCleanup(clockwork.stop);
  });

  return {
    players: () => run().players,
    round,
    tables,
    reported,
    reportedCount: landed,
    standings,
    standingOf: name => places().get(name),
    finished
  };
}
