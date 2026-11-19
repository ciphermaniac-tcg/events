/**
 * The dashboard's Playing tab: the account's events from its History (see
 * HistoryPage), split by where they stand. An event in progress leads, with
 * the round being played and the way to its page; with none, the next event
 * to come does, with its check-in; then, always, the way into an event by its
 * code; then the other events to come; then the latest results, decks as
 * sprites alone, with the way to the rest on /history.
 */

import { A } from '@solidjs/router';
import { MAIN_SITE } from '../../lib/constants';
import { t, timeOfDay } from '../../lib/i18n';
import { eventDay } from '../../lib/tournament/history';
import { isWallClock } from '../../../shared/tournament/timeZone';
import { createResource, For, type Resource, Show } from 'solid-js';
import { type HistoryEntry, type OwnHistory } from '../../lib/tournament/api';
import { loadEntry } from '../../lib/tournament/historyCopies';
import { latestValue, resolved } from '../../lib/resource';
import { DeckIcons } from './DeckIcons';
import { EventCodeForm } from './EventCodeForm';
import { ResourceFallback } from './Field';
import { HistoryList } from './HistoryList';

/** How many finished events the tab shows before sending the rest to /history. */
const RECENT = 5;

/** An event being played: its round, table and opponent once the copy is read, and its page. */
function LiveEntry(props: { entry: HistoryEntry }) {
  const [read] = createResource(() => props.entry, loadEntry);
  const result = () => resolved(read) ?? null;
  // The round still being played is the one without a result.
  const current = () => [...(result()?.finish.rounds ?? [])].reverse().find(row => !row.mark) ?? null;
  const opponent = () => {
    const key = current()?.opponent;
    return key ? (result()?.names.get(key) ?? null) : null;
  };
  return (
    <section class='tm-dash-live'>
      <p class='tm-dash-live-event muted'>
        {props.entry.name || props.entry.code}
        <Show when={current()}>{row => <> · {row().label}</>}</Show>
      </p>
      <Show when={current()} fallback={<p class='tm-dash-live-big'>{t('In progress')}</p>}>
        {row => (
          <p class='tm-dash-live-big'>
            <Show when={row().table > 0}>{t('Table {n}', { n: row().table })} </Show>
            <Show when={opponent()} fallback={<span class='muted'>{t('Waiting on pairings')}</span>}>
              {name => <>{t('vs {name}', { name: name() })}</>}
            </Show>
          </p>
        )}
      </Show>
      <Show when={result()?.finish.deck}>
        {deck => (
          <p class='tm-dash-live-deck'>
            <DeckIcons label={deck()} size={28} />
            {/* Assistive tech already reads the name with the icons. */}
            <span aria-hidden='true'>{deck()}</span>
          </p>
        )}
      </Show>
      <A class='btn btn-primary' href={`/t/${props.entry.code}`}>
        {t('Your match')}
      </A>
    </section>
  );
}

/** The next event the account is in, before its first round: its day, when check-in is, and the way to its registration. */
function NextEntry(props: { entry: HistoryEntry }) {
  const day = () => eventDay(props.entry.startsAt, props.entry.startDate);
  const checkIn = () => props.entry.checkInAt ?? '';
  return (
    <section class='tm-dash-live'>
      <p class='tm-dash-live-event muted'>
        {props.entry.name || props.entry.code}
        <Show when={day()}>{text => <> · {text()}</>}</Show>
      </p>
      <p class='tm-dash-live-big'>
        {isWallClock(checkIn()) ? t('Check-in {time}', { time: timeOfDay(checkIn()) }) : t('Registered')}
      </p>
      <A class='btn btn-primary' href={`/t/${props.entry.code}`}>
        {t('Your registration')}
      </A>
    </section>
  );
}

/** Events to come, soonest first; one with no start time set goes last. */
const soonest = (a: HistoryEntry, b: HistoryEntry) =>
  Number(!a.startsAt) - Number(!b.startsAt) || a.startsAt.localeCompare(b.startsAt);

function Group(props: { title: string; entries: readonly HistoryEntry[]; more?: boolean }) {
  return (
    <Show when={props.entries.length > 0}>
      <section class='tm-dash-section'>
        <div class='tm-dash-section-head'>
          <h2 class='tm-subhead'>{props.title}</h2>
          <Show when={props.more}>
            <A href='/history'>{t('All results')}</A>
          </Show>
        </div>
        <HistoryList entries={props.entries} iconsOnly />
      </section>
    </Show>
  );
}

/** A new account's tab, before its first event: the way to play, then the way to run events. */
function Welcome() {
  return (
    <section class='tm-welcome'>
      <h2 class='tm-welcome-title'>{t('Welcome to Ciphermaniac')}</h2>
      <ol class='tm-welcome-steps'>
        <li>
          <strong>{t('Find an event')}</strong>
          <span class='muted'>{t('Search for tournaments near you.')}</span>
          <a href={`${MAIN_SITE}/tools/event-locator`}>{t('Find events')}</a>
        </li>
        <li>
          <strong>{t('Add your Player ID')}</strong>
          <span class='muted'>{t('Your Play! Pokémon ID connects your results at participating events to you.')}</span>
          <A href='/settings'>{t('Settings')}</A>
        </li>
        <li>
          <strong>{t('Play')}</strong>
          <span class='muted'>{t('During a participating event, this page shows your table and opponent.')}</span>
        </li>
      </ol>
      <p class='tm-welcome-run'>
        <strong>{t('Running events?')}</strong>{' '}
        <span class='muted'>{t('Organize sanctioned or unsanctioned events with our tournament manager.')}</span>{' '}
        <A href='/apply'>{t('Apply here')}</A>
      </p>
    </section>
  );
}

export function PlayingTab(props: { history: Resource<OwnHistory>; onRetry: () => void }) {
  const entries = () => latestValue(props.history)?.entries;
  const byStatus = (status: HistoryEntry['status']) => (entries() ?? []).filter(entry => entry.status === status);
  const finished = () => byStatus('finished');
  const upcoming = () => byStatus('upcoming').sort(soonest);
  // With nothing being played, the next event leads, out of the list of the rest.
  const next = () => (byStatus('live').length === 0 ? upcoming()[0] : undefined);
  return (
    <>
      <For each={byStatus('live')}>{entry => <LiveEntry entry={entry} />}</For>
      <Show when={next()}>{entry => <NextEntry entry={entry()} />}</Show>
      {/* Shown whatever History holds, or while it loads or fails: a code needs none of it. */}
      <section class='tm-dash-section'>
        <div class='tm-dash-section-head'>
          <h2 class='tm-subhead'>{t('Join an event')}</h2>
        </div>
        <EventCodeForm />
      </section>
      <Show
        when={entries()}
        fallback={<ResourceFallback resource={props.history} onRetry={() => props.onRetry()} small />}
      >
        {list => (
          <Show when={list().length > 0} fallback={<Welcome />}>
            <Group title={t('Coming up')} entries={upcoming().filter(entry => entry !== next())} />
            <Group title={t('Results')} entries={finished().slice(0, RECENT)} more={finished().length > RECENT} />
          </Show>
        )}
      </Show>
    </>
  );
}
