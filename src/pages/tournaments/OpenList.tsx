/**
 * A player's list in their sheet, once the event's lists are open (see
 * listsPublic): every card's art five across with its count, or the list as
 * rows with a crop of each card's art, and the text to copy. Pressing a card
 * shows it large. A list handed in on paper says so; a player with none shows
 * nothing.
 */

import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { type DeckCard, parseDecklist } from '../../../shared/tournament/decklist';
import type { OpenList as List } from '../../../shared/tournament/view';
import { artCrop, cardArt } from '../../lib/cardArt';
import { msg, t, tn } from '../../lib/i18n';
import { fetchOpenList } from '../../lib/tournament/api';
import { createCopied } from './copied';
import { RetryError } from './Field';

type View = 'cards' | 'list';

const SECTIONS = [
  { section: 'pokemon', label: 'Pokémon' },
  { section: 'trainer', label: msg('Trainer') },
  { section: 'energy', label: msg('Energy') }
] as const;

/** Five across at a phone's width, or the sheet's. */
const GRID_SIZES = '(max-width: 640px) 19vw, 80px';

/** The player's list once round 1 is paired, when lists lock and open; until then, that it will show. */
export function OpenList(props: { code: string; player: string; locked: boolean }) {
  return (
    <Show when={props.locked} fallback={<p class='muted'>{t('Lists show here once round 1 is paired.')}</p>}>
      <ReadList code={props.code} player={props.player} />
    </Show>
  );
}

function ReadList(props: { code: string; player: string }) {
  const [list, setList] = createSignal<List | null | undefined>(undefined);
  const [error, setError] = createSignal<unknown>(null);
  // Only the latest ask is answered: another player's sheet, or a retry, drops what an earlier one brings back.
  let asked = 0;
  function load(code: string, player: string) {
    const ask = (asked += 1);
    setList(undefined);
    setError(null);
    fetchOpenList(code, player).then(
      answer => ask === asked && setList(answer.list),
      (err: unknown) => ask === asked && setError(err)
    );
  }
  // Memos, so only another event or player asks again, not every redraw of the view the props come from.
  const code = createMemo(() => props.code);
  const player = createMemo(() => props.player);
  createEffect(() => load(code(), player()));
  return (
    <Show when={!error()} fallback={<RetryError error={error()} onRetry={() => load(code(), player())} small />}>
      <Show when={list() !== undefined} fallback={<Skeleton height='240px' />}>
        <Show when={list()}>
          {shown => (
            <Show when={shown().mode === 'digital'} fallback={<p class='muted'>{t('Handed in on paper.')}</p>}>
              <Deck deck={shown().deck} />
            </Show>
          )}
        </Show>
      </Show>
    </Show>
  );
}

function Deck(props: { deck: string }) {
  const parsed = createMemo(() => parseDecklist(props.deck));
  const [view, setView] = createSignal<View>('cards');
  const { copied, copy } = createCopied();
  const [peek, setPeek] = createSignal<{ card: DeckCard; from: HTMLElement } | null>(null);
  const totals = () =>
    SECTIONS.map(s => ({
      ...s,
      cards: parsed().cards.filter(card => card.section === s.section)
    })).filter(s => s.cards.length > 0);
  const open = (card: DeckCard) => (event: MouseEvent) => setPeek({ card, from: event.currentTarget as HTMLElement });
  return (
    <section class='tm-open-list'>
      <div class='tm-open-list-bar'>
        <Segmented
          options={[
            { value: 'cards', label: t('Cards') },
            { value: 'list', label: t('List') }
          ]}
          selected={view()}
          onSelect={setView}
          ariaLabel={t('Decklist')}
        />
        <button type='button' class='btn btn-ghost' onClick={() => void copy(props.deck)}>
          {copied() ? t('Copied') : t('Copy list')}
        </button>
      </div>
      <Show
        when={view() === 'cards'}
        fallback={
          <ul class='tm-open-rows'>
            <For each={totals()}>
              {s => (
                <>
                  <li class='tm-open-rows-head'>
                    <span>{t(s.label)}</span>
                    <span class='muted num'>{count(s.cards)}</span>
                  </li>
                  <For each={s.cards}>
                    {card => (
                      <li>
                        <button type='button' class='tm-open-row' onClick={open(card)}>
                          <Art card={card} crop />
                          <span class='num tm-open-count'>{card.count}</span>
                          <span class='tm-open-name'>{card.name}</span>
                          <span class='tm-open-print num'>{[card.set, card.number].join(' ')}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </>
              )}
            </For>
          </ul>
        }
      >
        <div class='tm-open-grid'>
          <For each={parsed().cards}>
            {card => (
              <button type='button' class='tm-open-card' onClick={open(card)} aria-label={`${card.count} ${card.name}`}>
                <Art card={card} sizes={GRID_SIZES} />
                <span class='tm-open-qty num' aria-hidden='true'>
                  {card.count}
                </span>
              </button>
            )}
          </For>
        </div>
        <p class='tm-open-meta'>
          <span>
            {totals()
              .map(s => `${t(s.label)} ${count(s.cards)}`)
              .join(' · ')}
          </span>
          <span class='num'>{tn(parsed().total, '{n} card', '{n} cards')}</span>
        </p>
      </Show>
      <Show when={peek()}>{shown => <Peek card={shown().card} onClose={() => closePeek(shown().from)} />}</Show>
    </section>
  );
  function closePeek(from: HTMLElement) {
    setPeek(null);
    from.focus();
  }
}

const count = (cards: readonly DeckCard[]) => cards.reduce((sum, card) => sum + card.count, 0);

/** A card's art, whole or cropped to its art window; its name where there is no art to show. */
function Art(props: { card: DeckCard; crop?: boolean; sizes?: string }) {
  const [original, setOriginal] = createSignal(false);
  const art = () => cardArt(props.card, original());
  const [missing, setMissing] = createSignal(false);
  return (
    <Show
      when={!missing() && art()}
      fallback={
        <span class={props.crop ? 'tm-crop tm-art-missing' : 'tm-art tm-art-missing'} aria-hidden='true'>
          <Show when={!props.crop}>{props.card.name}</Show>
        </span>
      }
    >
      {shown => (
        <span class={props.crop ? 'tm-crop' : 'tm-art'} data-crop={props.crop ? artCrop(props.card) : undefined}>
          <img
            src={props.crop ? shown().small : shown().src}
            srcset={props.crop ? undefined : shown().srcset}
            sizes={props.crop ? undefined : props.sizes}
            alt=''
            loading='lazy'
            decoding='async'
            onError={() => (original() ? setMissing(true) : setOriginal(true))}
          />
        </span>
      )}
    </Show>
  );
}

/** One card large, over the sheet: any press or Escape puts it away. */
function Peek(props: { card: DeckCard; onClose: () => void }) {
  const [original, setOriginal] = createSignal(false);
  const art = () => cardArt(props.card, original());
  const close = () => props.onClose();
  return (
    <div
      class='tm-peek'
      role='dialog'
      aria-modal='true'
      aria-label={props.card.name}
      tabIndex={-1}
      ref={el => queueMicrotask(() => el.focus())}
      onClick={close}
      // Bound to the element, not delegated: the sheet closes on Escape at the document, and this puts away only the card.
      on:keydown={(event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <Show when={art()}>
        {shown => <img class='tm-peek-art' src={shown().large} alt='' onError={() => setOriginal(true)} />}
      </Show>
      <p>
        {props.card.count} × {props.card.name}{' '}
        <span class='tm-peek-print'>{[props.card.set, props.card.number].join(' ')}</span>
      </p>
      {/* Its press reaches the dialog's, which closes it. */}
      <button type='button' class='btn btn-secondary'>
        {t('Close')}
      </button>
    </div>
  );
}
