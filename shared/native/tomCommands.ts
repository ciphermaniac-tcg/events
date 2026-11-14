/**
 * The desktop app's commands for driving TOM, as its panel and the site call
 * them through Tauri's invoke. Every shape the Rust side returns is declared
 * here and nowhere else, so a change there is a change to this file only.
 *
 * Two ways in: 'inside' has the app's helper, running in TOM's own Java
 * process, enter codes without TOM needing focus (TOM must have been launched
 * from the app); 'keys' types each code into TOM's Speed Match Slip Entry
 * form, bringing TOM's window forward first.
 */

export type TomMode = 'inside' | 'keys';

/** What the app knows of TOM: where its program is, whether it runs, and whether the helper is in it. */
export interface TomStatus {
  path: string | null;
  running: boolean;
  inside: boolean;
}

/** What became of one code: TOM took it, refused it with its message, or could not be reached. */
export type SubmitResult =
  { status: 'accepted' } | { status: 'rejected'; message: string } | { status: 'not_ready'; reason: string };

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
    save: () => invoke<void>('tom_save')
  };
}
