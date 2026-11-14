/**
 * What the panel sends TOM, one request at a time, and what came of each.
 * TOM overwrites a result without asking, so nothing else is sent while a
 * request is under way.
 */

import { createSignal } from 'solid-js';
import { startRoundTrouble, type SubmitResult } from '../../../shared/native/tomCommands';
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

type Outcome = Pick<LogEntry, 'result' | 'ok'>;

function describe(result: SubmitResult | undefined): Outcome {
  if (!result) {
    return { result: 'No answer', ok: false };
  }
  if (result.status === 'accepted') {
    return { result: 'Accepted', ok: true };
  }
  const why = result.status === 'rejected' ? `Rejected: ${result.message}` : `Not ready: ${result.reason}`;
  return { result: why, ok: false };
}

export function createLog() {
  const [entries, setEntries] = createSignal<LogEntry[]>([]);
  const [busy, setBusy] = createSignal(false);
  let next = 0;

  const add = (items: readonly (Send & Outcome)[]) => {
    const at = Date.now();
    const added = items.map(item => ({ ...item, id: next++, at }));
    setEntries(old => [...added.reverse(), ...old].slice(0, KEPT));
  };

  /** Runs one request unless another is under way; a failure is logged for `items`. */
  async function one(items: readonly Send[], request: () => Promise<Outcome[]>) {
    if (busy() || items.length === 0) {
      return;
    }
    setBusy(true);
    try {
      const outcomes = await request();
      add(items.map((item, i) => ({ ...item, ...(outcomes[i] ?? describe(undefined)) })));
    } catch (err) {
      add(items.map(item => ({ ...item, result: errorText(err), ok: false })));
    } finally {
      setBusy(false);
    }
  }

  return {
    entries,
    busy,
    send: (items: readonly Send[]) =>
      one(items, async () => (await tom.submit(items.map(item => item.code))).map(describe)),
    /** Starts a pod's round in TOM, named by its category code. */
    startRound: (category: number, what: string) =>
      one([{ code: '', what }], async () => {
        const result = await tom.startRound(category);
        const trouble = startRoundTrouble(result);
        return [{ result: trouble ?? (result.status === 'started' ? 'Started' : 'Already started'), ok: !trouble }];
      })
  };
}

export type Log = ReturnType<typeof createLog>;
