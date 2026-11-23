/**
 * The desktop app's commands for driving TOM, as its panel and the site call
 * them through Tauri's invoke. The Rust side (native/src-tauri/src/tom.rs)
 * is the contract; every shape it returns is mirrored here and nowhere else.
 *
 * The app's helper, running in TOM's own Java process, enters each code
 * without TOM needing focus, so TOM must have been launched from the app.
 * TOM's round must be started for it to take results; tom_submit starts it
 * when it has to, and
 * the console starts it along with the site's clock (tom_start_round). TOM's
 * own round timer means nothing here: the site's clock is the one that counts.
 *
 * Pods are named by TOM's category code (0 Juniors, 1 Seniors, 2 Masters, 8,
 * 9 and 10 for divisions played together; see categoryCode in tdf.ts).
 */

/** A pod's current round as TOM's window shows it; no category when TOM's tab title was not one the app knows. */
export interface TomPod {
  category?: number;
  round: number;
  /** Running, paused or complete: TOM takes results for it. */
  started: boolean;
}

/** What TOM looks like right now, as far as the app's helper can tell. */
export interface TomStatus {
  /** The TOM program tom_launch starts, when one is known. */
  tomPath: string | null;
  /** TOM is running as the app's child. */
  launched: boolean;
  /** A submit would be attempted now; `reason` says why not. */
  ready: boolean;
  reason: string | null;
  tournamentOpen: boolean;
  slipDialogOpen: boolean;
  /** Titles of TOM's open windows. */
  windows: string[];
  pods: TomPod[];
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
 * taken; every later one comes back not_ready, unsent.
 */
export type SubmitResult =
  | { result: 'accepted'; code: string }
  | { result: 'rejected'; code: string; message: string }
  | { result: 'not_ready'; code: string; reason: string }
  | { result: 'uncertain'; code: string; reason: string };

export type SaveResult = { result: 'saved' } | { result: 'not_ready'; reason: string };

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
    /** TOM programs found in the usual install folders. */
    detect: () => invoke<string[]>('tom_detect'),
    /** The TOM program `path` resolves to, saved; rejects with a sentence when there is none there. */
    setPath: (path: string) => invoke<string>('tom_set_path', { path }),
    /** Starts TOM with the helper loaded; rejects with a sentence when it cannot. */
    launch: () => invoke<TomStatus>('tom_launch'),
    status: () => invoke<TomStatus>('tom_status'),
    /** A result per entry, in the order sent. With `event`, TOM must have that event open, alone. */
    submit: (entries: readonly SubmitEntry[], event?: TomEvent) =>
      invoke<SubmitResult[]>('tom_submit', { entries, ...eventArgs(event) }),
    save: () => invoke<SaveResult>('tom_save'),
    /** Shows the TOM panel, opening it if needed: the app opens without it, as most events never use TOM. */
    openPanel: () => invoke<void>('tom_open_panel'),
    /**
     * Starts a pod's current round in TOM; an event with one pod may leave the
     * pod out. With `round`, TOM's pod must be on it. `event` as for submit.
     */
    startRound: (pod?: number, event?: TomEvent, round?: number) =>
      invoke<StartRoundResult>('tom_start_round', { pod, round, ...eventArgs(event) })
  };
}
