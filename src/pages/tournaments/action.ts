/**
 * One request a form or button makes at a time: busy while it goes, the error
 * it left, and whether the last one landed. A press while one is on its way
 * does nothing, and every way out of the request ends busy, so no form has to
 * remember to.
 */

import { createSignal } from 'solid-js';
import { errorText } from '../../lib/tournament/api';

export interface ActionOptions {
  /** Stay busy after a request lands, for one that leaves the page: nothing can be pressed on the way out. */
  staysBusy?: boolean;
}

export function createAction(options: ActionOptions = {}) {
  const [busy, setBusy] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  /**
   * Runs a request: its answer, or nothing once it has shown why it failed or
   * while another is on its way. `onError` sees a failure after its words are
   * shown, for a form that must also let go of what it was showing.
   */
  async function run<T>(request: () => Promise<T>, onError?: (err: unknown) => void): Promise<T | undefined> {
    if (busy()) {
      return undefined;
    }
    setBusy(true);
    setError(null);
    try {
      const answer = await request();
      setSaved(true);
      setBusy(options.staysBusy === true);
      return answer;
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      onError?.(err);
      return undefined;
    }
  }
  /** Forgets how the last request went, for a form that now shows something else. */
  function clear() {
    setSaved(false);
    setError(null);
  }
  return { busy, saved, error, run, clear };
}
