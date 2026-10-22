/**
 * A store's pages, under /stores: its public page (/stores/:id), its
 * settings (/stores/:id/settings) and its invite links (/stores/join, which
 * the router reads as a store named "join"). One
 * entry from TournamentsPage, so the tournament shell pays for one lazy
 * route rather than three; each page is still its own chunk.
 */

import { useLocation, useParams } from '@solidjs/router';
import { Match, Switch } from 'solid-js';
import { lazyChunk } from '../../lib/preloadRecovery';

const StorePage = lazyChunk(() => import('./StorePage').then(m => ({ default: m.StorePage })));
const StoreSettingsPage = lazyChunk(() => import('./StoreSettingsPage').then(m => ({ default: m.StoreSettingsPage })));
const StoreJoinPage = lazyChunk(() => import('./StoreJoinPage').then(m => ({ default: m.StoreJoinPage })));

export function StoreRoutes() {
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  return (
    <Switch>
      <Match when={location.pathname === '/stores/join'}>
        <StoreJoinPage />
      </Match>
      <Match when={location.pathname.endsWith('/settings') && params.id} keyed>
        {id => <StoreSettingsPage id={id} />}
      </Match>
      <Match when={params.id} keyed>
        {id => <StorePage id={id} />}
      </Match>
    </Switch>
  );
}
