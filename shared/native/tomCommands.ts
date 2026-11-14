/**
 * The desktop app's commands for driving TOM, as its panel and the site call
 * them through Tauri's invoke. Every shape the Rust side returns is declared
 * here and nowhere else, so a change there is a change to this file only.
 *
 * Two ways in: 'inside' has the app's helper, running in TOM's own Java
 * process, enter codes without TOM needing focus (TOM must have been launched
 * from the app); 'keys' types each code into TOM's Speed Match Slip Entry
 * form, bringing TOM's window forward first. Either way TOM's round must be
 * started for it to take results; tom_submit starts it when it has to, and
 * the console starts it along with the site's clock (tom_start_round). TOM's
 * own round timer means nothing here: the site's clock is the one that counts.
 *
 * Pods are named by TOM's category code (0 Juniors, 1 Seniors, 2 Masters, 8,
 * 9 and 10 for divisions played together; see categoryCode in tdf.ts).
 */

export type TomMode = 'inside' | 'keys';

/** A pod's current round as TOM's window shows it. */
export interface TomPod {
  category: number;
  round: number;
  state: 'paired' | 'running' | 'paused';
}

/** What the app knows of TOM: where its program is, whether it runs, whether the helper is in it, and its pods. */
export interface TomStatus {
  path: string | null;
  running: boolean;
  inside: boolean;
  pods: TomPod[];
}

/** What became of one code: TOM took it, refused it with its message, or could not be reached. */
export type SubmitResult =
  { status: 'accepted' } | { status: 'rejected'; message: string } | { status: 'not_ready'; reason: string };

/** What came of starting a pod's round in TOM. */
export type StartRoundResult =
  | { status: 'started' }
  | { status: 'already_started' }
  | { status: 'not_ready'; reason: string; tomError?: string }
  | { status: 'rejected'; message?: string };

/** Why TOM's round did not start, or null when it runs, already running included. */
export function startRoundTrouble(result: StartRoundResult): string | null {
  if (result.status === 'not_ready') {
    return result.tomError ?? result.reason;
  }
  if (result.status === 'rejected') {
    return result.message ?? 'TOM refused';
  }
  return null;
}

/** Tauri's invoke, or anything with its shape. */
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function tomCommands(invoke: Invoke) {
  return {
    /** TOM's program where the app found it, or null. */
    detect: () => invoke<string | null>('tom_detect'),
    setPath: (path: string) => invoke<void>('tom_set_path', { path }),
    launch: () => invoke<void>('tom_launch'),
    status: () => invoke<TomStatus>('tom_status'),
    getMode: () => invoke<TomMode>('tom_get_mode'),
    setMode: (mode: TomMode) => invoke<void>('tom_set_mode', { mode }),
    /** One result per code, in the order sent. */
    submit: (codes: readonly string[]) => invoke<SubmitResult[]>('tom_submit', { codes }),
    save: () => invoke<void>('tom_save'),
    /** Starts a pod's current round in TOM; an event with one pod may leave the pod out. */
    startRound: (category?: number) =>
      invoke<StartRoundResult>('tom_start_round', category === undefined ? {} : { category })
  };
}
