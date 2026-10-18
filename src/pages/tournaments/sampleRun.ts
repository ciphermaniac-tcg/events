/**
 * The home page's sample event as it plays: one run of the engine's rounds
 * (lib/tournament/sampleEvent), stepped a result at a time in the order a
 * room reports them, which every preview on the page reads. A new event opens
 * already paired, so nothing on the page ever stands empty between events.
 * Under reduced motion it shows the finished event, at rest.
 */

import { batch, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { seededRandom, shuffled } from '../../../shared/tournament/random';
import { recordLabel } from '../../../shared/tournament/standings';
import {
  playSampleEvent,
  reportOrder,
  SAMPLE_PLAYERS,
  type SampleStanding,
  sampleStandings,
  type SampleTable
} from '../../lib/tournament/sampleEvent';

export const SAMPLE_ROUNDS = 5;
/** The player the phone and the profile follow. */
export const SAMPLE_FOCUS = 'Reese Lundquist';
/** Milliseconds between results landing. */
const BEAT = 320;
/** A beat to read a finished round before the next is paired. */
const READ = 1600;
/** How long the final standings rest before a new event starts. */
const REST = 4500;

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

/** Steps a run through its rounds on timers, and starts the next when one ends. */
function useClockwork(set: {
  run: (run: Run) => void;
  round: (n: number) => void;
  landed: (n: number) => void;
  finished: (done: boolean) => void;
}) {
  let timers: number[] = [];
  const later = (ms: number, then: () => void) => timers.push(window.setTimeout(then, ms));
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  function play(run: Run) {
    stop();
    batch(() => {
      set.run(run);
      set.round(1);
      set.landed(0);
      set.finished(false);
    });
    let at = 0;
    run.rounds.forEach((tables, r) => {
      if (r > 0) {
        later(at, () =>
          batch(() => {
            set.round(r + 1);
            set.landed(0);
          })
        );
      }
      tables.forEach((_, i) => later(at + (i + 1) * BEAT, () => set.landed(i + 1)));
      at += (tables.length + 1) * BEAT + READ;
    });
    later(at - READ, () => set.finished(true));
    later(at - READ + REST, () => play(newRun()));
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
    const clockwork = useClockwork({
      run: setRun,
      round: setRound,
      landed: setLanded,
      finished: setFinished
    });
    clockwork.play(first);
    onCleanup(() => {
      clockwork.stop();
    });
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

/** A seat's mark once its table is in: W, L or T; '' before. */
export function markOf(table: SampleTable, name: string | null, done: boolean): string {
  if (!done) {
    return '';
  }
  if (table.winner === null) {
    return 'T';
  }
  return table.winner === name ? 'W' : 'L';
}

/** "3-1-0", as standings write it. */
export const recordOf = (line: SampleStanding | undefined) => recordLabel(line ?? { wins: 0, losses: 0, ties: 0 });
