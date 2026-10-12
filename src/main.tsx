/* @refresh reload */
import { type Component, lazy } from 'solid-js';
import { render } from 'solid-js/web';
import { Navigate, Route, Router } from '@solidjs/router';

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';

import { App } from './app';
import { NotFoundPage } from './pages/NotFoundPage';
import { installPreloadRecovery } from './lib/preloadRecovery';
import { initTheme } from './lib/theme';

// A deploy replaces every content-hashed chunk, so a tab that predates it will
// fail the next lazy route's preload. Recover before any route can hit it.
installPreloadRecovery();

// Each page module exports its component by name; lazy() wants a default.
function page<K extends string>(load: () => Promise<Record<K, Component>>, name: K): Component {
  return lazy(() => load().then(m => ({ default: m[name] })));
}

const TournamentsPage = page(() => import('./pages/TournamentsPage'), 'TournamentsPage');

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element in index.html');
}

// Before render: an attribute swap after first paint is a visible flash.
initTheme();

render(
  () => (
    <Router root={App}>
      <Route path='/' component={() => <Navigate href='/host' />} />
      {/* One route for every tournament page: see TournamentsPage for why. */}
      <Route
        path={[
          '/host',
          '/host/:code',
          '/t/:code',
          '/settings',
          '/account',
          '/history',
          '/u/:handle',
          '/apply',
          '/welcome',
          '/privacy',
          '/terms',
          '/admin',
          '/stores/:id',
          '/stores/:id/settings'
        ]}
        component={TournamentsPage}
      />
      <Route path='*' component={NotFoundPage} />
    </Router>
  ),
  rootEl
);
