/**
 * One player's event, opened from any name on the public page: where they
 * stand, record, points and tiebreakers, then every round with the opponent,
 * the opponent's record and the result. A side sheet on desktop, a bottom
 * sheet on a phone. It is also where a player marks themselves, proving it
 * with their Player ID or last name, so the page can lead with their table
 * from then on, and where a spectator follows them. A viewer the page
 * already knows as a player is not offered to be another. Once they have a
 * standing, the sheet copies as an image to paste or send.
 */

import { createEffect, createSignal, on, Show } from 'solid-js';
import { percentLabel, recordLabel, type Standing } from '../../../shared/tournament/standings';
import type { Pod } from '../../../shared/tournament/types';
import { decklistOpenFor } from '../../../shared/tournament/lateLists';
import { decklistsLocked, type TournamentView } from '../../../shared/tournament/view';
import { t } from '../../lib/i18n';
import { imageToClipboard } from '../../lib/shareImage/clipboard';
import type { SheetData } from '../../lib/shareImage/playerShare';
import { mode } from '../../lib/theme';
import { createCopied } from './copied';
import { DeckIcons, deckSprites } from './DeckIcons';
import { HistoryTable } from './HistoryTable';
import { type Identified, IdentifyForm } from './Identify';
import { lazyPanel } from './lazyPanel';
import { Sheet } from './Sheet';
import { Tiebreaker } from './Tiebreaker';

const OpenList = lazyPanel(() => import('./OpenList').then(m => ({ default: m.OpenList })));

/**
 * Copies the sheet as an image. The clipboard write starts inside the click,
 * as Safari asks, with the image to follow: the renderer and its fonts load
 * on the first press, not with the page. Where the clipboard will not take an
 * image, the share sheet or a download has it instead.
 */
function CopyImage(props: { data: () => SheetData }) {
  const { copied, flash } = createCopied();
  let busy = false;
  const press = () => {
    if (busy) {
      return;
    }
    busy = true;
    const data = props.data();
    const renderer = import('../../lib/shareImage/render');
    const png = renderer.then(m => m.playerImage(data, mode()));
    imageToClipboard(png)
      .then(async done => {
        if (done) {
          flash();
        } else {
          await (await renderer).saveImage(png, data);
        }
      })
      .catch(() => undefined)
      .finally(() => (busy = false));
  };
  return (
    <button type='button' class='btn btn-secondary' onClick={press}>
      {copied() ? t('Copied') : t('Copy image')}
    </button>
  );
}

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
          <Show when={props.standing}>
            {standing => (
              <CopyImage
                data={() => ({
                  view: props.view,
                  pod: props.pod,
                  playerId: props.playerId,
                  standing: standing(),
                  place: props.place,
                  names: props.names,
                  records: props.records,
                  decks: props.decks,
                  sprites: deckSprites
                })}
              />
            )}
          </Show>
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
