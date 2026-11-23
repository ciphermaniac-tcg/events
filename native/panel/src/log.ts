/**
 * What the panel sends TOM, one request at a time, and what came of each.
 * TOM overwrites a result without asking, so nothing else is sent while a
 * request is under way.
 */

import { createSignal } from 'solid-js';
import { startRoundTrouble, type SubmitEntry, type SubmitResult } from '../../../shared/native/tomCommands';
import { errorText, tom } from './tom';

const KEPT = 30;

/** A result for TOM, and what it enters, for the log. */
export interface Send {
  entry: SubmitEntry;
  what: string;
}

interface Line {
  code: string;
  what: string;
}

export interface LogEntry extends Line {
  id: number;
  at: number;
  result: string;
  ok: boolean;
}

type Outcome = Pick<LogEntry, 'result' | 'ok'>;

/** Why TOM did not take an entry. */
function trouble(result: Exclude<SubmitResult, { result: 'accepted' }>): string {
  if (result.result === 'rejected') {
    return `Rejected: ${result.message}`;
  }
  if (result.result === 'not_ready') {
    return `Not sent: ${result.reason}`;
  }
  return `Uncertain, check TOM before sending again: ${result.reason}`;
}

/** A batch stops at the first entry TOM did not take; the later ones come back not sent. */
function describe(result: SubmitResult | undefined): Outcome {
  if (!result) {
    return { result: 'No answer', ok: false };
  }
  return result.result === 'accepted' ? { result: 'Accepted', ok: true } : { result: trouble(result), ok: false };
}

/** `tournament`: the picked file's event name, which TOM must have open, alone. */
export function createLog(tournament: () => string | undefined) {
  const [entries, setEntries] = createSignal<LogEntry[]>([]);
  const [busy, setBusy] = createSignal(false);
  let next = 0;

  const add = (items: readonly (Line & Outcome)[]) => {
    const at = Date.now();
    const added = items.map(item => ({ ...item, id: next++, at }));
    setEntries(old => [...added.reverse(), ...old].slice(0, KEPT));
  };

  /** Runs one request unless another is under way; a failure is logged for `items`. */
  async function one(items: readonly Line[], request: () => Promise<Outcome[]>) {
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
      one(
        items.map(({ entry, what }) => ({ code: entry.code, what })),
        async () => {
          const results = await tom.submit(
            items.map(item => item.entry),
            tournament()
          );
          return items.map((_, i) => describe(results[i]));
        }
      ),
    /** Starts a pod's round in TOM, named by its category code; TOM's pod must be on `round`. */
    startRound: (pod: number, round: number, what: string) =>
      one([{ code: '', what }], async () => {
        const result = await tom.startRound(pod, tournament(), round);
        const trouble = startRoundTrouble(result);
        return [{ result: trouble ?? (result.result === 'started' ? 'Started' : 'Already started'), ok: !trouble }];
      }),
    /** Has TOM save its file, which the panel then reads again. */
    save: () =>
      one([{ code: '', what: 'Save in TOM' }], async () => {
        const result = await tom.save();
        return [result.result === 'saved' ? { result: 'Saved', ok: true } : { result: result.reason, ok: false }];
      })
  };
}

export type Log = ReturnType<typeof createLog>;
