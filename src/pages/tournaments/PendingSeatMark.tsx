import { createMemo, type JSX, Show } from 'solid-js';
import { msg, t } from '../../lib/i18n';
import { awaitingMark, type SeatState } from '../../lib/tournament/awaitingMarks';
import { markText } from '../../lib/tournament/present';

const labels: Record<string, string> = { W: msg('Win'), L: msg('Loss'), T: msg('Tie') };

export function PendingSeatMark(props: SeatState & { enabled: boolean; children: JSX.Element }) {
  const state = createMemo(() => awaitingMark(props));
  const label = () => {
    const mark = labels[state().mark];
    const result = mark ? t(mark) : '';
    return state().pending ? t('{result}, awaiting acceptance', { result }) : result;
  };
  return (
    <Show when={props.enabled} fallback={props.children}>
      <span
        class='tm-mark tm-pending-mark'
        classList={{
          'is-win': state().mark === 'W',
          'is-loss': state().mark === 'L',
          'is-awaiting': state().pending,
          'is-problem': state().problem
        }}
        title={label()}
      >
        <span aria-hidden='true'>
          {markText(state().mark)}
          {state().pending ? '?' : ''}
        </span>
        <span class='sr-only'>{label()}</span>
      </span>
    </Show>
  );
}
