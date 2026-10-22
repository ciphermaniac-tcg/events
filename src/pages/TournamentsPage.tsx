/**
 * Every tournament route through one entry in main.tsx: / (the home page,
 * or signed in an organizer's events), /host/:code (running one), /t/:code (the public page
 * players follow), /settings (sign-in, sign-out and the player profile;
 * /account is its older name), /history (the events an account played),
 * /u/:handle (an account's public profile), /apply (applying to run events),
 * /welcome (a new sign-up's age check), /privacy (the privacy policy), /terms (the terms of service), /admin (an Admin's page), and a
 * store's /stores/:id (its public page), /stores/:id/settings and
 * /stores/join (its invite links).
 * One route rather than one each, because each route added to main.tsx is
 * paid for in the app shell; each page is still its own chunk, so a player
 * following pairings never downloads the organizer's console.
 */

import { useLocation, useParams } from '@solidjs/router';
import { createRenderEffect, Match, onCleanup, Switch } from 'solid-js';
import '../styles/pages/tournament.css';
import '../styles/pages/tournament-organizer.css';
import { latestValue } from '../lib/resource';
import { lazyChunk } from '../lib/preloadRecovery';
import { preloadManage, preloadPublished } from '../lib/tournament/api';
import { session } from './tournaments/session';

const SettingsPage = lazyChunk(() => import('./tournaments/SettingsPage').then(m => ({ default: m.SettingsPage })));
const HostIndex = lazyChunk(() => import('./tournaments/HostIndex').then(m => ({ default: m.HostIndex })));
const ManageEvent = lazyChunk(() => loadManageEvent().then(m => ({ default: m.ManageEvent })));
const loadPublicEvent = () => import('./tournaments/PublicEvent');
const loadManageEvent = () => import('./tournaments/ManageEvent');
const PublicEvent = lazyChunk(() => loadPublicEvent().then(m => ({ default: m.PublicEvent })));
const HistoryPage = lazyChunk(() => import('./tournaments/HistoryPage').then(m => ({ default: m.HistoryPage })));
const ProfilePage = lazyChunk(() => import('./tournaments/ProfilePage').then(m => ({ default: m.ProfilePage })));
const ApplyPage = lazyChunk(() => import('./tournaments/ApplyPage').then(m => ({ default: m.ApplyPage })));
const WelcomePage = lazyChunk(() => import('./tournaments/WelcomePage').then(m => ({ default: m.WelcomePage })));
const PrivacyPage = lazyChunk(() => import('./tournaments/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazyChunk(() => import('./tournaments/TermsPage').then(m => ({ default: m.TermsPage })));
const AdminPage = lazyChunk(() => import('./tournaments/AdminPage').then(m => ({ default: m.AdminPage })));
const StoreRoutes = lazyChunk(() => import('./tournaments/StoreRoutes').then(m => ({ default: m.StoreRoutes })));

/**
 * Asks for an event page's data, and with `code` its code too, so they arrive
 * side by side instead of one after the other. An invite link joins the staff
 * before the event is read (see ManageEvent), so it waits. Code is asked for
 * only once the page is on its way: a tab older than the deploy reloads when
 * a chunk is missing (see preloadRecovery.ts), which a link rested on must not do.
 */
function preloadEvent({ pathname, search }: Pick<Location, 'pathname' | 'search'>, code: boolean): void {
  const [, page, event = ''] = /^\/(t|host)\/(\w+)/.exec(pathname) ?? [];
  if (page === 't') {
    preloadPublished(event.toUpperCase());
  } else if (page === 'host' && !new URLSearchParams(search).has('invite')) {
    preloadManage(event.toUpperCase());
  } else {
    return;
  }
  if (code) {
    void (page === 't' ? loadPublicEvent() : loadManageEvent()).catch(() => undefined);
  }
}

/** A link this tab follows, under the event's target. */
function linkOf(event: Event): HTMLAnchorElement | null {
  const link = event.target instanceof Element ? event.target.closest('a') : null;
  return link && !link.target && link.origin === window.location.origin ? link : null;
}

// A page opened on an event asks for it now, as this module loads.
preloadEvent(window.location, true);

// And an event's link as it is pressed, or rested on with a mouse: the click comes
// a beat later, and the page can be on its way by then.
let resting: ReturnType<typeof setTimeout> | undefined;
document.addEventListener('pointerdown', event => {
  const link = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey ? linkOf(event) : null;
  if (link) {
    preloadEvent(link, true);
  }
});
document.addEventListener('pointerover', event => {
  clearTimeout(resting);
  const link = event.pointerType === 'mouse' ? linkOf(event) : null;
  if (link) {
    resting = setTimeout(() => preloadEvent(link, false), 80);
  }
});
document.addEventListener('pointerout', () => clearTimeout(resting));

export function TournamentsPage() {
  const location = useLocation();
  const params = useParams<{ code?: string; handle?: string }>();
  const code = () => (params.code ?? '').toUpperCase();
  const settings = () => location.pathname.startsWith('/account') || location.pathname.startsWith('/settings');
  // Nobody is signed in yet at the age check, and its only way on is the form.
  const welcome = () => location.pathname.startsWith('/welcome');
  const dashboard = () => location.pathname === '/' || location.pathname.startsWith('/host/');
  // Before the first paint: marked once its chunk arrives, the big screen shifted the whole page up.
  // BigScreen marks itself too, for a URL this misses.
  const bigScreen = () =>
    location.pathname.startsWith('/t/') && location.query.screen === '1' && location.query.stream === undefined;
  // A stream overlay's page is transparent from the first paint too: OBS reloads it over the live game.
  const stream = () => {
    const table = Number(location.query.table);
    return (
      location.pathname.startsWith('/t/') && location.query.stream === 'table' && Number.isInteger(table) && table > 0
    );
  };
  createRenderEffect(() => {
    document.body.classList.toggle('tm-screen-mode', bigScreen());
    document.body.classList.toggle('tm-stream-mode', stream());
  });
  onCleanup(() => document.body.classList.remove('tm-screen-mode', 'tm-stream-mode'));
  const organizer = () =>
    dashboard() ||
    settings() ||
    location.pathname === '/apply' ||
    /^\/stores\/[^/]+\/settings$/.test(location.pathname);
  return (
    <div classList={{ 'tm-organizer-surface': organizer() }}>
      <Switch fallback={<HostIndex />}>
        <Match when={settings()}>
          <SettingsPage />
        </Match>
        <Match when={location.pathname.startsWith('/history')}>
          <HistoryPage />
        </Match>
        <Match when={location.pathname.startsWith('/apply')}>
          <ApplyPage />
        </Match>
        <Match when={welcome()}>
          <WelcomePage />
        </Match>
        <Match when={location.pathname === '/privacy'}>
          <PrivacyPage />
        </Match>
        <Match when={location.pathname === '/terms'}>
          <TermsPage />
        </Match>
        <Match when={location.pathname.startsWith('/admin')}>
          <AdminPage />
        </Match>
        <Match when={location.pathname.startsWith('/stores/')}>
          <StoreRoutes />
        </Match>
        <Match when={location.pathname.startsWith('/u/') && params.handle} keyed>
          {handle => <ProfilePage handle={handle.toLowerCase()} />}
        </Match>
        <Match when={location.pathname.startsWith('/t/') && code()} keyed>
          {eventCode => <PublicEvent code={eventCode} session={latestValue(session)} />}
        </Match>
        <Match when={location.pathname.startsWith('/host/') && code()} keyed>
          {eventCode => <ManageEvent code={eventCode} />}
        </Match>
      </Switch>
    </div>
  );
}
