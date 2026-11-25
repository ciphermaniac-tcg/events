/**
 * The console's head for a TOM event in the desktop app, with TOM on for the
 * computer: the app keeps TOM open and follows its file (TomSyncPanel's
 * createAppFile), and the results entered here go into TOM by themselves,
 * one at a time, each as the code its match slip prints, entered by the
 * app's helper inside TOM. Each goes as the site has it when its turn comes,
 * so a result corrected meanwhile goes as corrected.
 *
 * Nothing is written to the file: a result stays pending here until a save
 * of TOM's has it. A result TOM took is not sent again meanwhile; one TOM may
 * or may not have, or that its file shows otherwise, is held (deliveries.ts).
 * One TOM refused, or whose match TOM holds another result for, is held too,
 * kept per event until TOM's file has it or its match is gone (`Marks`), as
 * is one TOM saved otherwise before it got there: the app never types over a
 * result in TOM. Those need the organizer in TOM, which their rows say
 * (tomNotes) and the Dock icon counts. One TOM was not ready for waits a
 * while, saying why on its row, and the others go meanwhile.
 *
 * The head's block says where things stand, the time of TOM's last save
 * under it; Show TOM brings TOM forward. Once TOM would not open, the head
 * offers trying again and the .tdf, downloaded with the results, and the
 * Dock icon counts every result waiting.
 */

import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import type { TomApp, TomEvent } from '../../../shared/native/tomCommands';
import type { Outcome, Tournament } from '../../../shared/tournament/types';
import { matchSlips, resultEntry } from '../../../shared/tournament/slipCodes';
import type { PendingResult } from '../../../shared/tournament/view';
import { nativeTom } from '../../lib/native/bridge';
import {
  type Deliveries,
  type Item,
  plan,
  recallDeliveries,
  recorded,
  rememberDeliveries,
  settled
} from '../../lib/native/deliveries';
import { RESULT_WORDS } from '../../lib/tournament/present';
import { intlLocale, t, tn } from '../../lib/i18n';

/** What a result's row says (see TomSyncPanel's tomNotes); `held`: it needs the organizer in TOM; `why`: why TOM was not ready. */
export interface TomNote {
  text: string;
  held: boolean;
  why?: string;
}

/** The parts of the console's TOM link (TomSyncPanel's createTomLink) the head works with. */
interface NativeLink {
  app: () => TomApp | null;
  event: () => string;
  tomEvent: () => TomEvent | null;
  /** Following TOM's file is paused (see TomSyncPanel's Lapse): nothing goes to TOM until it is reconnected. */
  locked: () => boolean;
  tournament: () => Tournament;
  results: () => readonly PendingResult[];
  pending: () => number;
  savedAt: () => number | null;
  write: () => Promise<void>;
  refresh: () => Promise<void>;
  setNotes: (notes: ReadonlyMap<string, TomNote>) => void;
}

/**
 * The results sent to TOM, by match (as deliveries.ts keys them), with the
 * result sent, its row, and what TOM holds instead: 'pending' when TOM
 * refused it, none until TOM answers otherwise.
 */
type Marks = Record<string, { sent: Outcome; row: string; tom?: Outcome }>;

/** How long a result TOM was not ready for waits before it goes again. */
const RETRY_MS = 10_000;

/** TOM's outcome codes, as the helper names the result TOM holds. */
const TOM_OUTCOMES: Partial<Record<number, Outcome>> = {
  1: 'p1',
  2: 'p2',
  3: 'tie',
  6: 'double-loss',
  10: 'double-loss'
};

const words = (outcome: Outcome) => t(RESULT_WORDS[outcome] ?? '');

export function NativeTom(props: { link: NativeLink }) {
  const tom = nativeTom();
  // eslint-disable-next-line solid/reactivity -- an event's console never changes event
  const [deliveries, setDeliveries] = createSignal<Deliveries>(recallDeliveries(props.link.event()));
  // eslint-disable-next-line solid/reactivity -- an event's console never changes event
  const [marks, setMarks] = createSignal<Marks>(recallDeliveries<Marks>(props.link.event(), 'held'));
  /** Results TOM was not ready for, by match and result, with why, until they go again. */
  const [waits, setWaits] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [sending, setSending] = createSignal(false);
  const slips = createMemo(() => matchSlips(props.link.tournament()));
  const current = createMemo(() => settled(deliveries(), slips()));
  const work = createMemo(() => plan(slips(), props.link.results(), current()));
  const open = () => props.link.app()?.tom === 'open';
  /** Each pending result with its slip code (none for a double loss), its key as deliveries.ts has it, and its row. */
  const rows = createMemo(() =>
    props.link.results().map(result => {
      const entry = resultEntry(slips(), result);
      const key = entry ? `${entry.pod}:${entry.round}:${entry.table}:${result.p1}:${result.p2}` : '';
      return { result, entry, key, row: `${result.pod}:${result.round}:${result.table}` };
    })
  );
  /**
   * The marks still standing: none once TOM's file has the result, the match
   * is gone, or the site no longer has that result (cleared, or changed, say
   * to TOM's); TOM's saved result where it differs, which stands until then.
   */
  const standing = createMemo(() => {
    const left: Marks = {};
    for (const [key, mark] of Object.entries(marks())) {
      const slip = slips().find(s => `${s.pod}:${s.round}:${s.table}:${s.p1}:${s.p2}` === key);
      if (!slip || slip.outcome === mark.sent) {
        continue;
      }
      if (slip.outcome !== 'pending') {
        left[key] = { ...mark, tom: slip.outcome };
      } else if (rows().some(each => each.key === key && each.result.outcome === mark.sent)) {
        left[key] = mark;
      }
    }
    return left;
  });
  /** Each pending result with its item to send or hold, and what TOM holds instead. */
  const entries = createMemo(() =>
    rows().map(each => {
      const mark = standing()[each.key];
      return {
        ...each,
        item: [...work().fresh, ...work().held].find(item => item.key === each.key),
        tom: mark?.sent === each.result.outcome ? mark.tom : undefined
      };
    })
  );
  /** What goes next: the first fresh result TOM has not held back, nor was just not ready for. */
  const due = () =>
    entries().find(
      each => each.item && !('state' in each.item) && !each.tom && !waits().has(`${each.item.key}:${each.item.sent}`)
    );

  const noteOf = (each: ReturnType<typeof entries>[number]): TomNote => {
    if (!each.entry || each.tom === 'pending') {
      return { text: t('fix it in TOM'), held: true };
    }
    if (each.tom) {
      return { text: t('TOM has {result}, fix it in TOM', { result: words(each.tom) }), held: true };
    }
    if (each.item && 'state' in each.item) {
      return { text: t('check it in TOM'), held: true };
    }
    const why = each.item && waits().get(`${each.item.key}:${each.item.sent}`);
    return { text: open() ? t('going into TOM') : t('waiting for TOM'), held: false, why };
  };
  /** Each row's note: the pending results', and a result TOM saved otherwise before it got there. */
  const notes = createMemo(() => {
    const map = new Map<string, TomNote>();
    for (const mark of Object.values(standing())) {
      if (mark.tom && mark.tom !== 'pending') {
        map.set(mark.row, { text: t('{result} here, check it in TOM', { result: words(mark.sent) }), held: true });
      }
    }
    for (const each of entries()) {
      map.set(each.row, noteOf(each));
    }
    return map;
  });
  const needYou = () => [...notes().values()].filter(note => note.held).length;

  const keep = (next: Deliveries) => {
    setDeliveries(next);
    rememberDeliveries(props.link.event(), next);
  };
  const mark = (added: Marks) => setMarks({ ...standing(), ...added });
  const wait = (tag: string, why: string) => {
    setWaits(old => new Map(old).set(tag, why));
    setTimeout(() => setWaits(old => new Map([...old].filter(([key]) => key !== tag))), RETRY_MS);
  };

  async function send(item: Item, row: string, event: TomEvent) {
    setSending(true);
    try {
      const results = await tom.submit([item.entry], event);
      keep(recorded(current(), [item], results));
      const [result] = results;
      const held = result?.result === 'not_ready' && result.held && (TOM_OUTCOMES[result.held] ?? 'pending');
      if (result?.result === 'rejected' || held) {
        mark({ [item.key]: { sent: item.sent, row, tom: held || 'pending' } });
      } else if (result?.result === 'not_ready') {
        wait(`${item.key}:${item.sent}`, result.reason);
      }
    } catch {
      keep(recorded(current(), [item]));
    } finally {
      setSending(false);
    }
  }

  createEffect(() => {
    const next = due();
    const event = props.link.tomEvent();
    if (next?.item && event && open() && !sending() && !props.link.locked()) {
      void send(next.item, next.row, event);
    }
  });
  // Each result for TOM is marked once seen, so one TOM saves otherwise even before it goes is caught.
  createEffect(() => {
    const unmarked = entries().filter(each => each.item && standing()[each.key]?.sent !== each.result.outcome);
    if (unmarked.length > 0) {
      mark(Object.fromEntries(unmarked.map(each => [each.key, { sent: each.result.outcome, row: each.row }])));
    }
  });
  // What stands is kept, so a mark that no longer does never comes back after a reload.
  createEffect(() => rememberDeliveries(props.link.event(), standing(), 'held'));
  createEffect(() => props.link.setNotes(notes()));
  // Once TOM would not open, every result waiting needs the organizer.
  createEffect(
    () => void tom.badge(props.link.app()?.tom === 'failed' ? props.link.pending() : needYou()).catch(() => undefined)
  );
  const write = () => void props.link.write();
  window.addEventListener('cm-tom-write', write);
  onCleanup(() => {
    window.removeEventListener('cm-tom-write', write);
    props.link.setNotes(new Map());
    void tom.badge(0).catch(() => undefined);
  });

  return (
    <>
      <Show
        when={props.link.app()?.tom === 'failed'}
        fallback={
          <button type='button' class='btn btn-ghost' onClick={() => void tom.show().catch(() => undefined)}>
            {t('Show TOM')}
          </button>
        }
      >
        <Show when={props.link.pending() > 0}>
          <button type='button' class='btn btn-ghost' onClick={write}>
            {tn(props.link.pending(), 'Write {n} to .tdf', 'Write {n} to .tdf')}
          </button>
        </Show>
        <button type='button' class='btn btn-secondary' onClick={() => void tom.retry().then(props.link.refresh)}>
          {t('Try again')}
        </button>
      </Show>
      <Block link={props.link} needYou={needYou()} />
    </>
  );
}

/** The large line says where TOM stands; the small one, when TOM last saved, or what waits on TOM. */
function Block(props: { link: NativeLink; needYou: number }) {
  const pending = () => props.link.pending();
  const saved = () => {
    const at = props.link.savedAt();
    return at === null
      ? ''
      : t('Saved by TOM {time}', { time: new Date(at).toLocaleTimeString(intlLocale(), { timeStyle: 'short' }) });
  };
  const waiting = () => (pending() > 0 ? tn(pending(), '{n} result waiting', '{n} results waiting') : saved());
  const line = (): [string, string, boolean] => {
    const phase = props.link.app()?.tom;
    if (phase === 'failed') {
      return [t('TOM didn’t open'), waiting(), true];
    }
    if (phase === 'reopening') {
      return [t('Reopening TOM'), waiting(), false];
    }
    // TOM is open with no event, or more than one tournament: nothing can go in until this one is open alone.
    if (!props.link.app()?.file) {
      return [t('Open this event in TOM'), waiting(), false];
    }
    if (props.needYou > 0) {
      return [tn(props.needYou, '{n} needs you in TOM', '{n} need you in TOM'), saved(), true];
    }
    const going = pending();
    return [going ? tn(going, 'Sending {n} result', 'Sending {n} results') : t('TOM has every result'), saved(), false];
  };
  return (
    <span class='tm-saved' classList={{ 'is-late': line()[2] }} title={props.link.app()?.reason ?? undefined}>
      <span class='tm-saved-ago'>{line()[0]}</span>
      <Show when={line()[1]}>
        <small>{line()[1]}</small>
      </Show>
    </span>
  );
}
