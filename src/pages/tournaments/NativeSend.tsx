/**
 * Sending the results TOM lacks straight into TOM, for the site running in
 * the desktop app. Each result goes as the code its match slip prints,
 * entered by the app's helper inside TOM or typed into TOM's Speed Match
 * Slip Entry form. Nothing is written to the file: the results stay pending
 * here until a save of TOM's has them, as after a write.
 */

import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { createSignal, onMount, Show } from 'solid-js';
import type { SubmitResult, TomMode } from '../../../shared/native/tomCommands';
import { matchSlips, resultEntry } from '../../../shared/tournament/slipCodes';
import type { Tournament } from '../../../shared/tournament/types';
import type { PendingResult } from '../../../shared/tournament/view';
import { nativeTom } from '../../lib/native/bridge';
import { errorText } from '../../lib/tournament/api';
import { msg, t, tn } from '../../lib/i18n';

const MODES: { value: TomMode; label: string }[] = [
  { value: 'inside', label: msg('Inside TOM') },
  { value: 'keys', label: msg('Speed Match typing') }
];

function reason(result: SubmitResult | undefined): string {
  if (result?.status === 'rejected') {
    return result.message;
  }
  if (result?.status === 'uncertain') {
    return t('TOM may have it, check before sending again');
  }
  return result?.status === 'not_ready' ? result.reason : t('No match slip');
}

/** How many TOM took, and why the first of the rest was not: a batch stops there. */
function summary(results: readonly SubmitResult[], total: number): string {
  const taken = results.filter(result => result.status === 'accepted').length;
  const sent = tn(taken, '{n} result sent to TOM', '{n} results sent to TOM');
  if (taken === total) {
    return sent;
  }
  const why = reason(results.find(result => result.status !== 'accepted'));
  return `${sent} · ${t('{n} not sent: {why}', { n: total - taken, why })}`;
}

export function NativeSend(props: { tournament: Tournament; pending: readonly PendingResult[] }) {
  const tom = nativeTom();
  const [asking, setAsking] = createSignal(false);
  const [mode, setMode] = createSignal<TomMode | null>(null);
  const [said, setSaid] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const fail = (err: unknown) => setSaid(errorText(err));
  onMount(() => void tom.getMode().then(setMode, fail));

  async function send() {
    const slips = matchSlips(props.tournament);
    const entries = props.pending.flatMap(result => resultEntry(slips, result) ?? []);
    setSending(true);
    try {
      setSaid(summary(await tom.submit(entries), props.pending.length));
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <span class='tm-write'>
      <button type='button' class='btn btn-secondary' aria-expanded={asking()} onClick={() => setAsking(!asking())}>
        {tn(props.pending.length, 'Send {n} result to TOM', 'Send {n} results to TOM')}
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
          <span class='tm-write-acts'>
            <button type='button' class='btn btn-ghost tm-small' onClick={() => setAsking(false)}>
              {t('Close')}
            </button>
            <button type='button' class='btn btn-primary tm-small' disabled={sending()} onClick={() => void send()}>
              {t('Send')}
            </button>
          </span>
        </div>
      </Show>
    </span>
  );
}
