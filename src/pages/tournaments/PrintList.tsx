/**
 * A decklist on paper: the event, the player, the list by section, and a QR
 * code to the event's page in the bottom corner. The sheet is drawn into the
 * page only while the browser prints it, and the print sheet hides the rest of
 * the page, so what comes out is real text at whatever paper the printer has.
 */

import { For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { intlLocale, msg, t } from '../../lib/i18n';
import { DIVISION_LABELS } from '../../../shared/tournament/types';
import type { DeckSection } from '../../../shared/tournament/decklist';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { type PrintSheet, printSheet, type SheetEvent } from './printSheet';
import { QrCode } from './QrCode';
import '../../styles/pages/tournament-print.css';

const LABELS: Record<DeckSection, string> = {
  pokemon: 'Pokémon',
  trainer: msg('Trainer'),
  energy: msg('Energy')
};

const submitted = (at: number) =>
  new Date(at).toLocaleString(intlLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

function Sheet(props: { sheet: PrintSheet }) {
  const event = () => props.sheet.event;
  const player = () => props.sheet.player;
  return (
    <article class='tm-print-page'>
      <header class='tm-print-event'>
        <div>
          <h1>{event().name}</h1>
          <p>{[event().date, event().place].filter(Boolean).join(' · ')}</p>
        </div>
        <p class='tm-print-format'>{event().format}</p>
      </header>
      <dl class='tm-print-who' classList={{ 'is-named': !player().popId }}>
        <div>
          <dt>{t('Player')}</dt>
          <dd>{player().name}</dd>
        </div>
        <Show when={player().popId}>
          <div>
            <dt>{t('Player ID')}</dt>
            <dd class='num'>{player().popId}</dd>
          </div>
          <div>
            <dt>{t('Birth year')}</dt>
            <dd class='num'>{player().birthYear ?? ''}</dd>
          </div>
          <div>
            <dt>{t('Division')}</dt>
            <dd>
              <Show when={player().division}>{division => t(DIVISION_LABELS[division()])}</Show>
            </dd>
          </div>
        </Show>
      </dl>
      <For each={props.sheet.sections}>
        {section => (
          <section class='tm-print-section'>
            <h2>
              <span>{t(LABELS[section.section])}</span>
              <span class='num'>{section.count}</span>
            </h2>
            <table>
              <tbody>
                <For each={section.cards}>
                  {card => (
                    <tr>
                      <td class='tm-print-count num'>{card.count}</td>
                      <td>{card.name}</td>
                      <td class='tm-print-set'>{card.set}</td>
                      <td class='tm-print-number num'>{card.number}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </section>
        )}
      </For>
      <Show when={props.sheet.unread.length > 0}>
        <section class='tm-print-section'>
          <h2>{t('Not read')}</h2>
          <ul>
            <For each={props.sheet.unread}>{line => <li>{line}</li>}</For>
          </ul>
        </section>
      </Show>
      <footer class='tm-print-foot'>
        <p>
          {t('Submitted {time}', { time: submitted(props.sheet.submittedAt) })} ·{' '}
          {t('Printed from Ciphermaniac Events')}
        </p>
        <QrCode text={event().url} label={event().name} />
      </footer>
    </article>
  );
}

/** Takes the sheet last printed away; set while one is drawn. */
let clear: (() => void) | null = null;

/**
 * Prints a player's list: draws its sheet, opens the browser's print, and
 * takes the sheet away once printing is done, or when the next print replaces
 * it, for a browser that never says printing is done.
 */
export function printList(
  event: SheetEvent,
  list: PlayerProfile & { deck: string; submittedAt: number },
  sanctioned: boolean
): void {
  clear?.();
  const root = document.createElement('div');
  root.className = 'tm-print';
  document.body.append(root);
  document.documentElement.classList.add('is-printing');
  const dispose = render(() => <Sheet sheet={printSheet(event, list, sanctioned, location.origin)} />, root);
  const done = () => {
    window.removeEventListener('afterprint', done);
    document.documentElement.classList.remove('is-printing');
    dispose();
    root.remove();
    clear = null;
  };
  clear = done;
  window.addEventListener('afterprint', done);
  window.print();
}
