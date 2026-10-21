import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import type { DisplayOptions } from '../../../shared/tournament/display';
import type { Pod } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { displayCapacity, type DisplayRow, displayRows, type DisplaySize } from './displayLayout';
import { markText, namesById, podLabel, seatMark, shownOutcome } from '../../lib/tournament/present';
import { t } from '../../lib/i18n';

/** Whole pages replace a crawl at large events. Each seat is listed separately in alphabetical mode. */
export function PagedDisplay(props: {
  view: TournamentView;
  pods: Pod[];
  options: DisplayOptions;
  font: number;
  /**
   * Auto scroll is off: timed pages wait too. Reduced motion starts it off
   * unless the screen was set to move, so pages stand still until resumed.
   */
  still: boolean;
}) {
  let root!: HTMLDivElement;
  const [size, setSize] = createSignal<DisplaySize>({ width: 0, height: 0 });
  // The first row of the page shown, so a screen that settles or is resized keeps it in view rather than starting over.
  const [first, setFirst] = createSignal(0);
  // eslint-disable-next-line solid/reactivity -- the screen's setting at the start; changes follow below
  const [turning, setTurning] = createSignal(!props.still);
  createEffect(
    on(
      () => props.still,
      still => setTurning(!still),
      { defer: true }
    )
  );
  const timed = () => props.options.pageSeconds > 0;
  const capacity = () => displayCapacity(size(), props.font, props.options.layout === 'alphabetical');
  const rows = createMemo(() =>
    displayRows(props.view.tournament, props.pods, props.options.layout === 'alphabetical')
  );
  const pages = () => Math.max(1, Math.ceil(rows().length / capacity().total));
  const current = () => Math.min(Math.floor(first() / capacity().total), pages() - 1);
  const shown = () => rows().slice(current() * capacity().total, (current() + 1) * capacity().total);
  const names = createMemo(() => namesById(props.view.tournament));
  const result = (row: DisplayRow) => {
    const { outcome } = shownOutcome(row.match, row.pod, row.round, props.view.pending);
    if (props.options.layout === 'alphabetical') {
      return markText(seatMark(outcome, row.player === row.match.p1 ? 1 : 2));
    }
    return [seatMark(outcome, 1), seatMark(outcome, 2)].filter(Boolean).map(markText).join('–');
  };
  const move = (by: number) => setFirst(((current() + by + pages()) % pages()) * capacity().total);
  const roundKey = createMemo(() => props.pods.map(pod => `${pod.category}:${pod.rounds.at(-1)?.number}`).join(','));
  createEffect(() => {
    void roundKey();
    void props.options.layout;
    setFirst(0);
  });
  createEffect(() => {
    if (!timed() || !turning()) {
      return;
    }
    const timer = setInterval(() => {
      if (!document.hidden) {
        move(1);
      }
    }, props.options.pageSeconds * 1000);
    onCleanup(() => clearInterval(timer));
  });
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(root);
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [role="tablist"]')) {
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        move(1);
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        move(-1);
      }
    };
    document.addEventListener('keydown', key);
    onCleanup(() => {
      observer.disconnect();
      document.removeEventListener('keydown', key);
    });
  });
  return (
    <div ref={root} class='tm-screen-paged'>
      <ol
        class='tm-screen-dense'
        classList={{ 'is-alphabetical': props.options.layout === 'alphabetical' }}
        style={{
          'grid-template-columns': `repeat(${capacity().columns}, minmax(0, 1fr))`,
          'grid-template-rows': `repeat(${capacity().rows}, minmax(0, 1fr))`
        }}
      >
        <For each={shown()}>
          {row => (
            <li>
              <span class='tm-screen-dense-names'>
                <strong>{names().get(row.player) ?? row.player}</strong>
                <span>
                  {row.opponent
                    ? names().get(row.opponent)
                    : ['bye', 'assigned-bye'].includes(row.match.outcome)
                      ? t('Bye')
                      : t('Missed round')}
                </span>
              </span>
              <span class='tm-screen-dense-table'>
                <strong class='num'>{row.match.table || '—'}</strong>
                <small>{props.pods.length > 1 ? podLabel(row.pod) : t('Table')}</small>
                <Show
                  when={result(row)}
                  fallback={
                    <Show when={row.match.timeExtension?.seconds}>
                      {seconds => (
                        <small class='tm-screen-extra'>{t('+{minutes} min', { minutes: seconds() / 60 })}</small>
                      )}
                    </Show>
                  }
                >
                  {mark => <small aria-label={t('Result')}>{mark()}</small>}
                </Show>
              </span>
            </li>
          )}
        </For>
      </ol>
      <div class='tm-screen-pagination'>
        <button type='button' class='btn btn-secondary' onClick={() => move(-1)} disabled={pages() === 1}>
          {t('Previous page')}
        </button>
        <span>{t('Page {n} of {total}', { n: current() + 1, total: pages() })}</span>
        <button type='button' class='btn btn-secondary' onClick={() => move(1)} disabled={pages() === 1}>
          {t('Next page')}
        </button>
        <Show when={timed() && pages() > 1}>
          <button type='button' class='btn btn-secondary' onClick={() => setTurning(!turning())}>
            {turning() ? t('Pause pages') : t('Resume pages')}
          </button>
        </Show>
      </div>
    </div>
  );
}
