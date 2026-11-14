import { Show } from 'solid-js';
import { baseName } from './tdfFile';
import type { TdfState } from './tdfState';

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { timeStyle: 'medium' });

export function FileSection(props: { file: TdfState }) {
  return (
    <section class='tp-section' aria-labelledby='tp-file'>
      <h2 id='tp-file'>Tournament file</h2>
      <Show when={props.file.path()} fallback={<p class='tp-line muted'>No .tdf linked</p>}>
        {path => (
          <p class='tp-line' title={path()}>
            {baseName(path())}
            <Show when={props.file.readAt()}>{at => <span class='muted'> · Read {clock(at())}</span>}</Show>
          </p>
        )}
      </Show>
      <div class='tp-acts'>
        <button type='button' class='btn btn-secondary' onClick={() => void props.file.link()}>
          {props.file.path() ? 'Link another .tdf' : 'Link .tdf'}
        </button>
      </div>
      <Show when={props.file.error()}>
        {error => (
          <p class='tp-error' role='alert'>
            {error()}
          </p>
        )}
      </Show>
    </section>
  );
}
