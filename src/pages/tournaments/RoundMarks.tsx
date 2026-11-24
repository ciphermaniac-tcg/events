import { For } from 'solid-js';
import { t } from '../../lib/i18n';
import { markText } from '../../lib/tournament/present';

/**
 * A player's rounds as the pairings mark them: plain letters, a win in the
 * positive ink, a round still to play left blank. `marks` holds W, L, T or ''
 * per round played; `rounds` pads the row out to the rounds so far.
 */
export function RoundMarks(props: { marks: readonly string[]; rounds?: number }) {
  const cells = () => [
    ...props.marks,
    ...Array.from({ length: Math.max(0, (props.rounds ?? 0) - props.marks.length) }, () => '')
  ];
  return (
    <span
      class='tm-round-marks'
      role='img'
      aria-label={t('Rounds: {marks}', { marks: props.marks.filter(Boolean).map(markText).join(' ') || t('none yet') })}
    >
      <For each={cells()}>
        {mark => (
          <span class='tm-mark' classList={{ 'is-win': mark === 'W' }} aria-hidden='true'>
            {markText(mark)}
          </span>
        )}
      </For>
    </span>
  );
}
