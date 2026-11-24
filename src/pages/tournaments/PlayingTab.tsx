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
      <Show
        when={current()}
        fallback={
          <Show when={result()}>
            {done => (
              <p class='tm-dash-live-big'>{t('Waiting on round {n}', { n: done().finish.rounds.length + 1 })}</p>
            )}
          </Show>
        }
      >
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
      {/* Between rounds there is no match to open, only the event's page to wait on. */}
      <A class='btn btn-primary' href={`/t/${props.entry.code}`}>
        {current() ? t('Open match') : t('Event page')}
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
        {t('View registration')}
      </A>
    </section>
  );
}

/** Events to come, soonest first; one with no start time set goes last. */
const soonest = (a: HistoryEntry, b: HistoryEntry) =>
  Number(!a.startsAt) - Number(!b.startsAt) || a.startsAt.localeCompare(b.startsAt);

/** `toCome`: events not yet played, which have no place or record to show. */
function Group(props: { title: string; entries: readonly HistoryEntry[]; more?: boolean; toCome?: boolean }) {
  return (
    <Show when={props.entries.length > 0}>
      <section class='tm-dash-section'>
        <div class='tm-dash-section-head'>
          <h2 class='tm-subhead'>{props.title}</h2>
          <Show when={props.more}>
            <A href='/history'>{t('All results')}</A>
          </Show>
        </div>
        <HistoryList entries={props.entries} iconsOnly toCome={props.toCome} />
      </section>
    </Show>
  );
}

/** A new account's tab, before its first event: the ways worth taking, less the ones already taken. */
function Welcome(props: { hasId: boolean; runs: boolean }) {
  return (
    <section class='tm-welcome'>
      <p class='muted tm-empty'>{t('No events yet.')}</p>
      <p class='tm-welcome-links'>
        <a href={`${MAIN_SITE}/tools/event-locator`}>{t('Find an event')}</a>
        <Show when={!props.hasId}>
          <A href='/settings'>{t('Add your Player ID')}</A>
        </Show>
        <Show when={!props.runs}>
          <A href='/apply'>{t('Run events')}</A>
        </Show>
      </p>
    </section>
  );
}

/** `hasId`: the account holds a Player ID. `runs`: it may run events, or has asked to. */
export function PlayingTab(props: {
  history: Resource<OwnHistory>;
  onRetry: () => void;
  hasId: boolean;
  runs: boolean;
}) {
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
          <Show when={list().length > 0} fallback={<Welcome hasId={props.hasId} runs={props.runs} />}>
            <Group title={t('Coming up')} entries={upcoming().filter(entry => entry !== next())} toCome />
            <Group title={t('Results')} entries={finished().slice(0, RECENT)} more={finished().length > RECENT} />
          </Show>
        )}
      </Show>
    </>
  );
}
