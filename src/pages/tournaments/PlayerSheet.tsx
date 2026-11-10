/**
 * One player's event, opened from any name on the public page: where they
 * stand, record, points and tiebreakers, then every round with the opponent,
 * the opponent's record and the result. A side sheet on desktop, a bottom
 * sheet on a phone. It is also where a player marks themselves, proving it
 * with their Player ID or last name, so the page can lead with their table
 * from then on, and where a spectator follows them. A viewer the page
 * already knows as a player is not offered to be another.
 */

import { createEffect, createSignal, on, Show } from 'solid-js';
import { percentLabel, recordLabel, type Standing } from '../../../shared/tournament/standings';
import type { Pod } from '../../../shared/tournament/types';
import { decklistOpenFor } from '../../../shared/tournament/lateLists';
import { decklistsLocked, type TournamentView } from '../../../shared/tournament/view';
import { t } from '../../lib/i18n';
import { DeckIcons } from './DeckIcons';
import { HistoryTable } from './HistoryTable';
import { type Identified, IdentifyForm } from './Identify';
import { lazyPanel } from './lazyPanel';
import { Sheet } from './Sheet';
import { Tiebreaker } from './Tiebreaker';

const OpenList = lazyPanel(() => import('./OpenList').then(m => ({ default: m.OpenList })));

export function PlayerSheet(props: {
  view: TournamentView;
  playerId: string;
  pod: Pod;
  standing: Standing | undefined;
  /** Where they stand, as "2nd in Masters". */
  place: string;
  names: Map<string, string>;
  /** Each player's record so far. */
  records: Map<string, string>;
  decks: Record<string, string>;
  /** The viewer's own player, once the page knows them. */
  me: string | null;
  /** Whether this device follows the player, for the pairings' Following filter. */
  following: boolean;
  onFollow: () => void;
  onIdentified: (found: Identified) => void;
  onForget: () => void;
  onClose: () => void;
  onPlayer: (id: string) => void;
}) {
  const [proving, setProving] = createSignal(false);
  // Opening another player's sheet starts over rather than asking for them.
  createEffect(
    on(
      () => props.playerId,
      () => setProving(false),
      { defer: true }
    )
  );
  return (
    <Sheet
      title={
        <>
          <DeckIcons label={props.decks[props.playerId]} size={22} />
          {props.names.get(props.playerId)}
        </>
      }
      sub={
        <>
          {props.place}
          <Show when={props.decks[props.playerId]}>{label => <> · {label()}</>}</Show>
        </>
      }
      onClose={props.onClose}
      foot={
        <>
          <button
            type='button'
            class='btn btn-secondary tm-follow'
            aria-pressed={props.following}
            onClick={() => props.onFollow()}
          >
            {props.following ? t('Following') : t('Follow')}
          </button>
          <Show when={props.me === props.playerId}>
            <button type='button' class='btn btn-ghost' onClick={() => props.onForget()}>
              {t('This isn’t me')}
            </button>
          </Show>
          <Show when={props.me === null}>
            <Show
              when={proving()}
              fallback={
                <button type='button' class='btn btn-primary' onClick={() => setProving(true)}>
                  {t('This is me')}
                </button>
              }
            >
              <button type='button' class='btn btn-ghost' onClick={() => setProving(false)}>
                {t('Cancel')}
              </button>
            </Show>
          </Show>
        </>
      }
    >
      {/* Their list leads, above the record, at an event whose decklists are open, once it locks. */}
      <Show
        when={
          props.view.settings.decklists === 'open' &&
          !(decklistsLocked(props.view) && decklistOpenFor(props.view, props.playerId))
        }
      >
        <OpenList code={props.view.code} player={props.playerId} locked={decklistsLocked(props.view)} />
      </Show>
      <Show when={props.standing}>
        {row => (
          <dl class='tm-sheet-stats'>
            <div>
              <dd class='num'>{recordLabel(row().record)}</dd>
              <dt>{t('Record')}</dt>
            </div>
            <div>
              <dd class='num'>{row().points}</dd>
              <dt>{t('Points')}</dt>
            </div>
            <div>
              <dd class='num'>{percentLabel(row().owp)}</dd>
              <dt>
                <Tiebreaker name='OWP' />
              </dt>
            </div>
            <div>
              <dd class='num'>{percentLabel(row().oowp)}</dd>
              <dt>
                <Tiebreaker name='OOWP' />
              </dt>
            </div>
          </dl>
        )}
      </Show>
      <HistoryTable
        pod={props.pod}
        playerId={props.playerId}
        names={props.names}
        records={props.records}
        decks={props.decks}
        onPlayer={props.onPlayer}
      />
      <Show when={proving()}>
        <IdentifyForm
          view={props.view}
          idPrefix='sheet'
          submitLabel={t('Confirm')}
          expect={props.playerId}
          autofocus
          onFound={found => {
            setProving(false);
            props.onIdentified(found);
          }}
        />
      </Show>
    </Sheet>
  );
}
