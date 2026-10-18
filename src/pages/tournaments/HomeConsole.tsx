/**
 * The home page's admin console: the sample event as its organizer runs it,
 * with the console's own tabs to look around in. Pairings and Standings follow
 * the event as it plays; the other tabs show what a night like it holds.
 * Nothing here is saved anywhere.
 */

import { createSignal, For, Index, type JSX, Match, Show, Switch } from 'solid-js';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { TabPanel, Tabs } from '@ciphermaniac/design/components/Tabs';
import { SAMPLE_CODE, type SampleTable } from '../../lib/tournament/sampleEvent';
import { msg, t, tn } from '../../lib/i18n';
import { SampleDeck } from './SampleDeck';
import { markOf, recordOf } from '../../lib/tournament/sampleSchedule';
import { SAMPLE_ROUNDS, type SampleRun } from './sampleRun';

type Tab = 'pairings' | 'players' | 'standings' | 'decklists' | 'penalties' | 'settings';

const TABS: { value: Tab; label: string }[] = [
  { value: 'pairings', label: msg('Pairings') },
  { value: 'players', label: msg('Players') },
  { value: 'standings', label: msg('Standings') },
  { value: 'decklists', label: msg('Decklists') },
  { value: 'penalties', label: msg('Penalties') },
  { value: 'settings', label: msg('Settings') }
];

function resultOf(table: SampleTable, done: boolean): string {
  if (!done) {
    return '—';
  }
  if (table.winner === null) {
    return '1–1';
  }
  return table.winner === table.p1 ? '1–0' : '0–1';
}

function SeatCell(props: { run: SampleRun; table: SampleTable; name: string | null; done: boolean; lead?: boolean }) {
  const mark = () => markOf(props.table, props.name, props.done);
  return (
    <span class='tm-hc-seat'>
      <span class='tm-hc-mark' classList={{ 'is-win': mark() === 'W' }}>
        {mark()}
      </span>
      <SampleDeck player={props.name} />
      <span classList={{ 'tm-hc-lead': props.lead }}>{props.name ?? t('Bye')}</span>
      <span class='tm-hc-record num'>{props.name ? recordOf(props.run.standingOf(props.name)?.line) : ''}</span>
    </span>
  );
}

function PairingsPane(props: { run: SampleRun }) {
  const [only, setOnly] = createSignal<'all' | 'open'>('all');
  return (
    <div class='tm-hc-panel'>
      <div class='tm-hc-toolbar'>
        <span class='tm-hc-round'>{t('Round {n}', { n: props.run.round() })}</span>
        <span class='tm-hc-tally'>
          {t('{n} of {total} tables reported', { n: props.run.reportedCount(), total: props.run.tables().length })}
        </span>
        <span class='tm-grow' />
        <Segmented
          options={[
            { value: 'all', label: t('All tables') },
            { value: 'open', label: t('In progress') }
          ]}
          selected={only()}
          onSelect={setOnly}
          ariaLabel={t('Tables')}
        />
      </div>
      <table class='tm-hc-table tm-hc-pairs'>
        <thead>
          <tr>
            <th>{t('Table')}</th>
            <th>{t('Player')}</th>
            <th class='tm-hc-wide'>{t('Opponent')}</th>
            <th>{t('Result')}</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.run.tables()}>
            {(table, i) => {
              const done = () => props.run.reported(i());
              return (
                <Show when={only() === 'all' || !done()}>
                  <tr>
                    <td class='tm-hc-n num'>{i() + 1}</td>
                    <td>
                      <SeatCell run={props.run} table={table} name={table.p1} done={done()} lead />
                    </td>
                    <td class='tm-hc-wide'>
                      <SeatCell run={props.run} table={table} name={table.p2} done={done()} />
                    </td>
                    <td class='num'>{resultOf(table, done())}</td>
                  </tr>
                </Show>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}

const StandingsPane = (props: { run: SampleRun }) => (
  <table class='tm-hc-table tm-hc-panel'>
    <thead>
      <tr>
        <th>#</th>
        <th>{t('Player')}</th>
        <th>{t('Record')}</th>
      </tr>
    </thead>
    <tbody>
      <Index each={props.run.standings().slice(0, 10)}>
        {(line, i) => (
          <tr>
            <td class='tm-hc-n num'>{i + 1}</td>
            <td>
              <span class='tm-hc-seat'>
                <SampleDeck player={line().name} />
                {line().name}
              </span>
            </td>
            <td class='num'>{recordOf(line())}</td>
          </tr>
        )}
      </Index>
    </tbody>
  </table>
);

/** A pane of fixed sample rows: each column's head, whether a phone drops it, and its cells. */
function FixedTable(props: { heads: [head: string, wide?: boolean][]; rows: JSX.Element[][] }) {
  return (
    <table class='tm-hc-table tm-hc-panel'>
      <thead>
        <tr>
          <For each={props.heads}>{([head, wide]) => <th classList={{ 'tm-hc-wide': wide }}>{t(head)}</th>}</For>
        </tr>
      </thead>
      <tbody>
        <For each={props.rows}>
          {row => (
            <tr>
              <For each={row}>{(cell, i) => <td classList={{ 'tm-hc-wide': props.heads[i()]?.[1] }}>{cell}</td>}</For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

/** Each list's state; a problem reads as the deck check reports it (shared/tournament/decklist). */
const CHECKS: [player: string, status: string, problem?: boolean][] = [
  ['Andrew Hedrick', msg('Checked')],
  ['Annie Haberstroh', msg('Checked')],
  ['Cynthia Rodriguez', '5 copies of Grand Tree (the limit is 4)', true],
  ['Jane Ester', msg('Paper list, to check')],
  ['Lake Lubrano', msg('Checked')],
  ['Reese Lundquist', msg('Checked')]
];

const PENALTIES: [round: number, player: string, infraction: string, penalty: string][] = [
  [1, 'Colby Rose', msg('Tardiness'), msg('Warning')],
  [2, 'Iris Morgan', msg('Drawing extra cards'), msg('Prize penalty')]
];

const lead = (name: string) => <span class='tm-hc-lead'>{name}</span>;

/** The roster as staff see it before round 1: deck, check-in and fee. */
const PlayersPane = (props: { run: SampleRun }) => (
  <FixedTable
    heads={[[msg('Player')], [msg('Deck'), true], [msg('Checked in')], [msg('Paid')]]}
    rows={[...props.run.players()]
      .sort()
      .slice(0, 10)
      .map(name => [lead(name), <SampleDeck player={name} named />, t('Yes'), '$10.00'])}
  />
);

const DecklistsPane = () => (
  <FixedTable
    heads={[[msg('Player')], [msg('Deck'), true], [msg('Status')]]}
    rows={CHECKS.map(([name, status, problem]) => [
      lead(name),
      <SampleDeck player={name} named />,
      problem ? <span class='tm-hc-problem'>{status}</span> : t(status)
    ])}
  />
);

const PenaltiesPane = () => (
  <FixedTable
    heads={[[msg('Round')], [msg('Player')], [msg('Infraction')], [msg('Penalty'), true]]}
    rows={PENALTIES.map(([round, name, infraction, penalty]) => [round, lead(name), t(infraction), t(penalty)])}
  />
);

const SETTINGS: [label: string, value: () => string][] = [
  [msg('Rounds'), () => String(SAMPLE_ROUNDS)],
  [msg('Round time'), () => tn(50, '{n} minute', '{n} minutes')],
  [msg('Top cut'), () => t('Top {n}', { n: 8 })],
  [msg('Entry fee'), () => '$10.00'],
  [msg('Player cap'), () => '32'],
  [msg('Decklists'), () => t('Due before round 1')]
];

function SettingsPane() {
  return (
    <dl class='tm-hc-settings tm-hc-panel'>
      <For each={SETTINGS}>
        {([label, value]) => (
          <div>
            <dt>{t(label)}</dt>
            <dd>{value()}</dd>
          </div>
        )}
      </For>
    </dl>
  );
}

export function HomeConsole(props: { run: SampleRun }) {
  const [tab, setTab] = createSignal<Tab>('pairings');
  const next = () =>
    props.run.round() >= SAMPLE_ROUNDS ? t('Finalize') : t('Pair round {n}', { n: props.run.round() + 1 });
  return (
    <section class='tm-hc' aria-label={t('A sample admin console')}>
      <p class='tm-hc-crumb'>
        {t('Your events')} / <span>Friday League</span>
      </p>
      <div class='tm-hc-head'>
        <div>
          <p class='tm-hc-title'>Friday League</p>
          <p class='tm-hc-meta'>
            <b>{t('Round {n}', { n: props.run.round() })}</b> · {SAMPLE_CODE} · {t('Swiss on this site')} ·{' '}
            {tn(props.run.players().length, '{n} player', '{n} players')}
          </p>
        </div>
        <span class='btn btn-primary tm-hc-next' aria-hidden='true'>
          {next()}
        </span>
      </div>
      <Tabs
        id='tm-home-console'
        options={TABS.map(o => ({ ...o, label: t(o.label) }))}
        selected={tab()}
        onSelect={setTab}
        ariaLabel={t('Event sections')}
      />
      <TabPanel tabs='tm-home-console' selected={tab()}>
        <Switch>
          <Match when={tab() === 'pairings'}>
            <PairingsPane run={props.run} />
          </Match>
          <Match when={tab() === 'players'}>
            <PlayersPane run={props.run} />
          </Match>
          <Match when={tab() === 'standings'}>
            <StandingsPane run={props.run} />
          </Match>
          <Match when={tab() === 'decklists'}>
            <DecklistsPane />
          </Match>
          <Match when={tab() === 'penalties'}>
            <PenaltiesPane />
          </Match>
          <Match when={tab() === 'settings'}>
            <SettingsPane />
          </Match>
        </Switch>
      </TabPanel>
    </section>
  );
}
