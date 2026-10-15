/** How a section of store settings saves: one request at a time, and the bar at its foot that says how it went. */

import { createSignal, type JSX, Show } from 'solid-js';
import { errorText } from '../../lib/tournament/api';
import { ErrorLine } from './Field';

/** One save of a section: busy while it goes, the error it left, and whether the last one landed. */
export function createSave() {
  const [busy, setBusy] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  /** Runs a request, busy while it goes: its answer, or nothing once it has shown why it failed. */
  async function run<T>(request: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      const answer = await request();
      setSaved(true);
      return answer;
    } catch (err) {
      setError(errorText(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  /** Forgets how the last save went, for a section that now shows something else. */
  function clear() {
    setSaved(false);
    setError(null);
  }
  return { busy, saved, error, run, clear };
}

/** Save at the foot of a section, then `children` (more actions): what it is waiting on, the error, or that it saved. */
export function SaveBar(props: {
  dirty: boolean;
  busy: boolean;
  saved: boolean;
  error: string | null;
  reason?: string | null;
  children?: JSX.Element;
}) {
  return (
    <div class='tm-store-save'>
      <button type='submit' class='btn btn-primary' disabled={!props.dirty || props.busy || Boolean(props.reason)}>
        Save
      </button>
      {props.children}
      <Show when={props.reason && props.dirty}>
        <span class='muted'>{props.reason}</span>
      </Show>
      <Show when={props.saved && !props.dirty}>
        <span class='muted' role='status'>
          Saved
        </span>
      </Show>
      <ErrorLine message={props.error} />
    </div>
  );
}
