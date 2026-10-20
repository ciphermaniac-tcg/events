/**
 * / signed in: the account's dashboard, one tab per part it plays.
 * Playing is every account's (its History, see PlayingTab); Organizing
 * belongs to an account that may start events or already runs or staffs one
 * (the organizer's lists, see HostIndex). An Admin gets a link to /admin
 * after the tabs. With one tab and no Admin link there is no switch, only its
 * name.
 *
 * The tabs are the page's heading on a wide screen, beside the account menu;
 * on a phone they move to a bar along the bottom of the screen, and the
 * heading is the open tab's name. The open tab is kept in the address. With
 * none asked for, an event running now opens its tab, then an organizer's
 * events, then Playing.
 */

import { A, useNavigate, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  Match,
  type Resource,
  Show,
  Switch,
  untrack
} from 'solid-js';
import type { MyApplication } from '../../../shared/accounts/types';
import { isAdmin } from '../../../shared/accounts/roles';
import { canCreateEvents } from '../../../shared/accounts/stores';
import { rovingIndex } from '@ciphermaniac/design/lib/roving';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { fetchHistory, listTournaments, type Me, type TournamentSummary } from '../../lib/tournament/api';
import { accountList } from '../../lib/tournament/accountMemory';
import { applicantStage, fetchApplication } from '../../lib/tournament/applications';
import { latestValue } from '../../lib/resource';
import { pendingApplications } from './pendingApplications';
import { createSessionCatchUp } from './ApplicantStatus';
import { PlayingTab } from './PlayingTab';
import '../../styles/pages/tournament-dashboard.css';
import { pageTitle } from '../../lib/title';
import { msg, t } from '../../lib/i18n';
import { ResourceFallback } from './Field';

export type Tab = 'playing' | 'organizing';

const LABELS: Record<Tab, string> = { playing: msg('Playing'), organizing: msg('Organizing') };

const ICONS: Record<Tab | 'admin', JSX.Element> = {
  playing: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <rect x='5' y='3' width='14' height='18' rx='2' />
      <path d='M9 8h6M9 12h6' />
    </svg>
  ),
  organizing: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <rect x='3' y='5' width='18' height='16' rx='2' />
      <path d='M3 10h18M8 3v4M16 3v4' />
    </svg>
  ),
  admin: (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M12 3l8 4v5c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V7z' />
    </svg>
  )
};

interface Shown {
  tab: Tab;
  count: number;
}

/** Answered, or showing a kept answer while it is read again. */
const settled = (resource: Resource<unknown>) => resource.state !== 'unresolved' && resource.state !== 'pending';

/**
 * The tabs, as a strip under the heading (`wide`) or the phone's bottom bar;
 * only one shows at a time. The arrow keys, Home and End move between them.
 * An Admin's way to /admin follows them as a link, with the Applications
 * waiting (`admin`, null for anyone else).
 */
function TabList(props: {
  shown: Shown[];
  tab: Tab;
  onSelect: (tab: Tab) => void;
  wide: boolean;
  admin: number | null;
}) {
  let list: HTMLDivElement | undefined;
  const id = (tab: Tab) => `tm-dash-${props.wide ? 'tab' : 'bar'}-${tab}`;
  function key(event: KeyboardEvent) {
    const from = props.shown.findIndex(s => s.tab === props.tab);
    const to = rovingIndex(event.key, from, props.shown.length);
    const next = to === null ? undefined : props.shown[to];
    if (next) {
      event.preventDefault();
      props.onSelect(next.tab);
      list?.querySelector<HTMLElement>(`#${id(next.tab)}`)?.focus();
    }
  }
  return (
    <div class={props.wide ? 'tm-dash-tabs tm-dash-wide' : 'tm-dash-bar tm-dash-phone'}>
      <div ref={list} class='tm-dash-tablist' role='tablist' aria-label={t('Dashboard')} onKeyDown={key}>
        <For each={props.shown}>
          {s => (
            <button
              type='button'
              role='tab'
              id={id(s.tab)}
              aria-selected={s.tab === props.tab}
              aria-controls='tm-dash-panel'
              tabIndex={s.tab === props.tab ? 0 : -1}
              onClick={() => props.onSelect(s.tab)}
            >
              <Show when={!props.wide}>{ICONS[s.tab]}</Show>
              <span>
                {t(LABELS[s.tab])}
                <Show when={s.count > 0}>
                  <span class='tm-dash-count'>{s.count}</span>
                </Show>
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={props.admin !== null}>
        <A class='tm-dash-link' href='/admin'>
          <Show when={!props.wide}>{ICONS.admin}</Show>
          <span>
            {t('Admin')}
            <Show when={(props.admin ?? 0) > 0}>
              <span class='tm-dash-count'>{props.admin}</span>
            </Show>
          </span>
        </A>
      </Show>
    </div>
  );
}

export function Dashboard(props: {
  /** The account the lists belong to; another account is another dashboard. */
  account: string;
  user: Me;
  organizing: (events: readonly TournamentSummary[], application: Resource<MyApplication | null>) => JSX.Element;
}) {
  const [params, setParams] = useSearchParams<{ tab?: string; new?: string; section?: string }>();
  // Both lists open on this tab's last answer, if any, while they are read again.
  const account = untrack(() => props.account);
  const [events, { refetch: retryEvents }] = accountList('events', account, () =>
    listTournaments().then(answer => answer.tournaments)
  );
  const [history, { refetch }] = accountList('history', account, fetchHistory);
  const admin = () => isAdmin(props.user.role);

  const runningNow = () => (latestValue(events) ?? []).filter(event => !event.finished && event.rounds > 0).length;
  // A History unread for an error counts nothing here; the Playing tab says why.
  const playingNow = () =>
    (history.error ? [] : (latestValue(history)?.entries ?? [])).filter(e => e.status === 'live').length;
  const mayCreate = () => canCreateEvents(props.user.role, props.user.stores);
  // An account that may not start events is asked where its Application stands: one under way
  // shows the Organizing tab, where ApplicantLine says so, and one approved since the session
  // was read has the session read again.
  const [application] = createResource(
    () => !mayCreate(),
    () => fetchApplication().then(answer => answer.application)
  );
  createSessionCatchUp(
    () => props.user.role,
    () => latestValue(application)
  );
  const applied = () => !mayCreate() && applicantStage(props.user.role, latestValue(application) ?? null) !== 'none';
  const organizes = () => mayCreate() || applied() || (latestValue(events) ?? []).length > 0;

  const shown = (): Shown[] => [
    { tab: 'playing', count: playingNow() },
    ...(organizes() || events.error ? [{ tab: 'organizing' as const, count: runningNow() }] : [])
  ];
  const adminLink = () => (admin() ? pendingApplications() : null);
  // The tab strip shows with a choice to make: two tabs, or one beside Admin.
  const barred = () => shown().length > 1 || admin();
  /** The tab to open with none asked for: a running event's, then a match being played, then an organizer's events. */
  const fallbackTab = (): Tab => {
    if (params.new || runningNow() > 0) {
      return organizes() ? 'organizing' : 'playing';
    }
    return playingNow() === 0 && organizes() ? 'organizing' : 'playing';
  };
  // Which tabs there are, and which opens, waits on everything that decides them; once chosen,
  // the opening tab holds, so nothing read later moves the page out from under someone.
  const ready = () => settled(events) && settled(history) && (mayCreate() || settled(application));
  const [opening, setOpening] = createSignal<Tab | null>(null);
  createEffect(() => {
    if (opening() === null && ready()) {
      setOpening(untrack(fallbackTab));
    }
  });
  const tab = (): Tab | null =>
    shown().find(s => s.tab === params.tab)?.tab ??
    (opening() === null ? null : (shown().find(s => s.tab === opening())?.tab ?? 'playing'));
  // The Admin tab moved to /admin; an old address for it goes there, its section with it.
  const navigate = useNavigate();
  createEffect(() => {
    if (params.tab === 'admin') {
      navigate(params.section ? `/admin?tab=${encodeURIComponent(params.section)}` : '/admin', { replace: true });
    }
  });
  const select = (next: Tab) => setParams({ tab: next }, { replace: true });

  createEffect(() => {
    const open = tab();
    if (open) {
      document.title = pageTitle(t(LABELS[open]));
    }
  });

  return (
    <Show when={opening() && tab()} fallback={<Skeleton height='200px' />}>
      {open => (
        <div class='tm-dash' classList={{ 'tm-dash-barred': barred() }}>
          <header class='tm-dash-head'>
            <Show when={barred()} fallback={<h1 class='tm-dash-title'>{t(LABELS[open()])}</h1>}>
              {/* Above a phone's bar the open tab's name heads the page; wider, the tabs say it, and it is read only. */}
              <h1 class='tm-dash-title tm-dash-phone-title'>{t(LABELS[open()])}</h1>
              <TabList shown={shown()} tab={open()} onSelect={select} wide admin={adminLink()} />
            </Show>
          </header>
          <Show when={barred()}>
            <TabList shown={shown()} tab={open()} onSelect={select} wide={false} admin={adminLink()} />
          </Show>
          <div id='tm-dash-panel' role='tabpanel' aria-label={t(LABELS[open()])}>
            <Switch>
              <Match when={open() === 'playing'}>
                <PlayingTab history={history} onRetry={() => void refetch()} />
              </Match>
              <Match when={open() === 'organizing'}>
                <Show
                  when={latestValue(events)}
                  fallback={<ResourceFallback resource={events} onRetry={() => void retryEvents()} height='200px' />}
                >
                  {list => props.organizing(list(), application)}
                </Show>
              </Match>
            </Switch>
          </div>
        </div>
      )}
    </Show>
  );
}
