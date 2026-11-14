/**
 * Sending codes to TOM, one batch at a time, and what came of each. TOM
 * overwrites a result without asking, so nothing else is sent while a batch
 * is under way.
 */

import { createSignal } from 'solid-js';
import type { SubmitResult } from '../../../shared/native/tomCommands';
import { errorText, tom } from './tom';

const KEPT = 30;

export interface Send {
  code: string;
  /** What the code enters, for the log. */
  what: string;
}

export interface LogEntry extends Send {
  id: number;
  at: number;
  result: string;
  ok: boolean;
}

function describe(result: SubmitResult | undefined): string {
  if (!result) {
    return 'No answer';
  }
  if (result.status === 'accepted') {
    return 'Accepted';
  }
  return result.status === 'rejected' ? `Rejected: ${result.message}` : `Not ready: ${result.reason}`;
}

export function createLog() {
  const [entries, setEntries] = createSignal<LogEntry[]>([]);
  const [busy, setBusy] = createSignal(false);
  let next = 0;

  const add = (items: readonly Send[], result: (i: number) => { text: string; ok: boolean }) => {
    const at = Date.now();
    const added = items.map((item, i) => ({ ...item, id: next++, at, result: result(i).text, ok: result(i).ok }));
    setEntries(old => [...added.reverse(), ...old].slice(0, KEPT));
  };

  async function send(items: readonly Send[]) {
    if (busy() || items.length === 0) {
      return;
    }
    setBusy(true);
    try {
      const results = await tom.submit(items.map(item => item.code));
      add(items, i => ({ text: describe(results[i]), ok: results[i]?.status === 'accepted' }));
    } catch (err) {
      add(items, () => ({ text: errorText(err), ok: false }));
    } finally {
      setBusy(false);
    }
  }

  return { entries, busy, send };
}

export type Log = ReturnType<typeof createLog>;
