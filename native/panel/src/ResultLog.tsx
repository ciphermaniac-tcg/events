import { For, Show } from 'solid-js';
import type { LogEntry } from './log';

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { timeStyle: 'medium' });

export function ResultLog(props: { entries: LogEntry[] }) {
  return (
    <section class='tp-section' aria-labelledby='tp-log'>
      <h2 id='tp-log'>Log</h2>
      <Show when={props.entries.length > 0} fallback={<p class='tp-line muted'>Nothing sent yet</p>}>
        <ol class='tp-log' role='log'>
          <For each={props.entries}>
            {entry => (
              <li>
                <time class='muted'>{clock(entry.at)}</time>
                <span class='tp-num'>{entry.code}</span>
                <span>{entry.what}</span>
                <span classList={{ 'tp-bad': !entry.ok }}>{entry.result}</span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </section>
  );
}
