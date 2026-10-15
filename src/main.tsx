/* @refresh reload */
import { render } from 'solid-js/web';
import { Navigate, Route, Router } from '@solidjs/router';

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';

import { App } from './app';
import { NotFoundPage } from './pages/NotFoundPage';
// Every page here is a tournament page: loaded with the shell, not after it.
import { TournamentsPage } from './pages/TournamentsPage';
import { installPreloadRecovery } from './lib/preloadRecovery';
import { initTheme } from './lib/theme';
import { initEventMemory } from './lib/tournament/sessionMemory';

// A deploy replaces every content-hashed chunk, so a tab that predates it will
// fail the next lazy route's preload. Recover before any route can hit it.
installPreloadRecovery();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element in index.html');
}

// Before render: an attribute swap after first paint is a visible flash.
initTheme();
initEventMemory();

render(
  () => (
    <Router root={App}>
      {/* The home page moved from /host to the root; old links keep their query. */}
      <Route path='/host' component={() => <Navigate href={({ location }) => `/${location.search}`} />} />
      {/* One route for every tournament page: see TournamentsPage for why. */}
      <Route
        path={[
          '/',
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
