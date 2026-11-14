/**
 * Sending the results TOM lacks straight into TOM, for the site running in
 * the desktop app. Each result goes as the code its match slip prints,
 * entered by the app's helper inside TOM or typed into TOM's Speed Match
 * Slip Entry form. Nothing is written to the file: the results stay pending
 * here until a save of TOM's has them, as after a write. A result TOM took
 * is not sent again meanwhile, and one TOM may or may not have, or that its
 * file shows otherwise, is sent again only on its own (see deliveries.ts).
 */

import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import type { SubmitResult, TomMode } from '../../../shared/native/tomCommands';
import { matchSlips } from '../../../shared/tournament/slipCodes';
import type { Tournament } from '../../../shared/tournament/types';
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
import { errorText } from '../../lib/tournament/api';
import { msg, t, tn } from '../../lib/i18n';

const MODES: { value: TomMode; label: string }[] = [
  { value: 'inside', label: msg('Inside TOM') },
  { value: 'keys', label: msg('Speed Match typing') }
];

const HELD = { uncertain: msg('TOM may have it'), contradicted: msg('TOM’s file differs') };

function reason(result: SubmitResult | undefined): string {
  if (result?.result === 'rejected') {
    return result.message;
  }
  if (result?.result === 'uncertain') {
    return t(HELD.uncertain);
  }
  return result?.result === 'not_ready' ? result.reason : t('No match slip');
}

/** How many TOM took, and why the first of the rest was not: a batch stops there. */
function summary(results: readonly SubmitResult[], total: number): string {
  const taken = results.filter(result => result.result === 'accepted').length;
  const sent = tn(taken, '{n} result sent to TOM', '{n} results sent to TOM');
  if (taken === total) {
    return sent;
  }
  const why = reason(results.find(result => result.result !== 'accepted'));
  return `${sent} · ${t('{n} not sent: {why}', { n: total - taken, why })}`;
}

export function NativeSend(props: { event: string; tournament: Tournament; pending: readonly PendingResult[] }) {
  const tom = nativeTom();
  const [asking, setAsking] = createSignal(false);
  const [mode, setMode] = createSignal<TomMode | null>(null);
  const [said, setSaid] = createSignal('');
  const [sending, setSending] = createSignal(false);
  // eslint-disable-next-line solid/reactivity -- an event's console never changes event
  const [deliveries, setDeliveries] = createSignal<Deliveries>(recallDeliveries(props.event));
  const slips = createMemo(() => matchSlips(props.tournament));
  const current = createMemo(() => settled(deliveries(), slips()));
  const work = createMemo(() => plan(slips(), props.pending, current()));
  const count = () => work().fresh.length + work().held.length;
  const fail = (err: unknown) => setSaid(errorText(err));
  onMount(() => void tom.getMode().then(setMode, fail));

  const keep = (next: Deliveries) => {
    setDeliveries(next);
    rememberDeliveries(props.event, next);
  };

  async function send(items: readonly Item[]) {
    setSending(true);
    try {
      const results = await tom.submit(items.map(item => item.entry));
      keep(recorded(current(), items, results));
      setSaid(summary(results, items.length));
    } catch (err) {
      keep(recorded(current(), items));
      fail(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <span class='tm-write'>
      <button
        type='button'
        class='btn btn-secondary'
        aria-expanded={asking()}
        disabled={count() === 0 && !asking()}
        onClick={() => setAsking(!asking())}
      >
        {count() ? tn(count(), 'Send {n} result to TOM', 'Send {n} results to TOM') : t('Sent to TOM')}
      </button>
      <Show when={asking()}>
        <div
          class='tm-write-ask'
          role='group'
          aria-label={t('Send results to TOM')}
          onKeyDown={event => event.key === 'Escape' && setAsking(false)}
        >
          <Segmented
            options={MODES.map(option => ({ value: option.value, label: t(option.label) }))}
            selected={mode()}
            onSelect={next => void tom.setMode(next).then(() => setMode(next), fail)}
            ariaLabel={t('How results reach TOM')}
          />
          <Show when={said()}>
            <p role='status'>{said()}</p>
          </Show>
          <For each={work().held}>
            {item => (
              <p>
                {t('Round {round} table {table}: {why}', {
                  round: item.entry.round,
                  table: item.entry.table,
                  why: t(HELD[item.state])
                })}{' '}
                <button
                  type='button'
                  class='btn btn-ghost tm-small'
                  disabled={sending()}
                  onClick={() => void send([item])}
                >
                  {t('Send again')}
                </button>
              </p>
            )}
          </For>
          <span class='tm-write-acts'>
            <button type='button' class='btn btn-ghost tm-small' onClick={() => setAsking(false)}>
              {t('Close')}
            </button>
            <button
              type='button'
              class='btn btn-primary tm-small'
              disabled={sending() || work().fresh.length === 0}
              onClick={() => void send(work().fresh)}
            >
              {t('Send')}
            </button>
          </span>
        </div>
      </Show>
    </span>
  );
}
