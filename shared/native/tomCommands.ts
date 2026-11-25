/**
 * The desktop app's commands for TOM, as the site calls them through Tauri's
 * invoke. The Rust side (native/src-tauri/src/tom.rs) is the contract; every
 * shape it returns is mirrored here and nowhere else.
 *
 * TOM is a setting of the computer's, off until the person turns it on in
 * the app. While it is on, the app keeps TOM open and follows the .tdf TOM
 * has open; the site reads that file's text and sends results. The app's
 * helper, running in TOM's own Java process, enters each code without TOM
 * needing focus.
 * TOM's round must be started for it to take results; tom_submit starts it
 * when it has to, and
 * the console starts it along with the site's clock (tom_start_round). TOM's
 * own round timer means nothing here: the site's clock is the one that counts.
 *
 * Pods are named by TOM's category code (0 Juniors, 1 Seniors, 2 Masters, 8,
 * 9 and 10 for divisions played together; see categoryCode in tdf.ts).
 */

/**
 * TOM on this computer: whether the person has it on; whether TOM is open
 * (its helper answers), being opened again, or would not open, and why; and
 * the .tdf TOM has open, or last had, whose `source` changes when TOM opens
 * another file.
 */
export interface TomApp {
  on: boolean;
  tom: 'open' | 'reopening' | 'failed';
  reason: string | null;
  file: { name: string; source: number } | null;
}

/**
 * One result for TOM, as the parts of its match slip code and the code
 * itself, so the app can check the code against the event's layout and
 * refuse one that does not spell it: a bare code can read two ways in a pod
 * with flights. Outcome 1 is Player 1 winning, 2 Player 2, 3 a tie. The
 * app's helper enters it only when TOM's live pairings seat p1 and p2 there
 * with no other result; one TOM already holds comes back accepted untyped.
 */
export interface SubmitEntry {
  /** TOM's category code for the pod. */
  pod: number;
  /** The flight digit; null where the code has none (the app reads null as absent). */
  flight: number | null;
  round: number;
  table: number;
  outcome: 1 | 2 | 3;
  code: string;
  /** TOM player IDs in seats 1 and 2. */
  p1: string;
  p2: string;
}

/**
 * What became of one entry: TOM took it, refused it, it was not sent, or it
 * may have reached TOM unseen ('uncertain': check TOM before sending it
 * again, never resend it on its own). A batch stops at the first entry not
 * taken; every later one comes back not_ready, unsent. A not_ready one whose
 * match TOM already holds another result for says which, as `held`: TOM's
 * outcome code (1 P1 wins, 2 P2 wins, 3 tie, 6 double loss).
 */
export type SubmitResult =
  | { result: 'accepted'; code: string }
  | { result: 'rejected'; code: string; message: string }
  | { result: 'not_ready'; code: string; reason: string; held?: number }
  | { result: 'uncertain'; code: string; reason: string };

/** What came of starting a pod's round in TOM; a not_ready reason carries TOM's own error text. */
export type StartRoundResult =
  { result: 'started' } | { result: 'already_started' } | { result: 'not_ready'; reason: string };

/** Why TOM's round did not start, or null when it runs, already running included. */
export const startRoundTrouble = (result: StartRoundResult): string | null =>
  result.result === 'not_ready' ? result.reason : null;

/**
 * The event TOM must have open, alone: its name as TOM titles its window and,
 * when it has one, its sanction ID, which TOM's live data must hold too.
 */
export interface TomEvent {
  name: string;
  /** '' when the event has none. */
  sanctionId: string;
}

const eventArgs = (event?: TomEvent) => ({ tournament: event?.name, tournamentId: event?.sanctionId || undefined });

/** Tauri's invoke, or anything with its shape. */
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function tomCommands(invoke: Invoke) {
  return {
    state: () => invoke<TomApp>('tom_state'),
    /**
     * The .tdf TOM has open, as the app last read it; null when it is still
     * the read at `since`, when TOM has since opened another file than
     * `source`, or when it cannot be read.
     */
    read: (since: number, source: number) =>
      invoke<{ modified: number; text: string } | null>('tom_read', { since, source }),
    /** Asks the person, in the app, whether the file TOM has open (`source`, named by the app) is this event's. */
    confirmEvent: (source: number) => invoke<boolean>('tom_confirm_event', { source }),
    /** Asks the person, in the app, to turn TOM on; true once it is on. */
    turnOn: () => invoke<boolean>('tom_turn_on'),
    turnOff: () => invoke<void>('tom_turn_off'),
    /** Brings TOM to the front; rejects with a sentence when it cannot. */
    show: () => invoke<void>('tom_show'),
    /** Opens TOM again once it would not open. */
    retry: () => invoke<void>('tom_retry'),
    /** The count on the app's Dock icon, cleared at 0. */
    badge: (count: number) => invoke<void>('tom_badge', { count }),
    /** A result per entry, in the order sent. With `event`, TOM must have that event open, alone. */
    submit: (entries: readonly SubmitEntry[], event?: TomEvent) =>
      invoke<SubmitResult[]>('tom_submit', { entries, ...eventArgs(event) }),
    /**
     * Starts a pod's current round in TOM; an event with one pod may leave the
     * pod out. With `round`, TOM's pod must be on it. `event` as for submit.
     */
    startRound: (pod?: number, event?: TomEvent, round?: number) =>
      invoke<StartRoundResult>('tom_start_round', { pod, round, ...eventArgs(event) })
  };
}
