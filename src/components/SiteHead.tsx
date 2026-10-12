/**
 * The events site's head: its name, the way out to the event locator, and on
 * the home page, for someone signed out, the jump to its sign-in.
 * @module components/SiteHead
 */

import { A, useLocation } from '@solidjs/router';
import { Show } from 'solid-js';
import { MAIN_SITE } from '../lib/constants';
import { latestValue } from '../lib/resource';
import { session } from '../pages/tournaments/session';

export function SiteHead() {
  const location = useLocation();
  const signedOut = () => latestValue(session)?.user === null;
  return (
    <header class='site-head'>
      <A href='/' class='site-head-name'>
        <img src='/logo.svg' alt='' width='24' height='28' />
        <span>
          Ciphermaniac <small>Events</small>
        </span>
      </A>
      <nav aria-label='Ciphermaniac Events'>
        <a href={`${MAIN_SITE}/tools/event-locator`} class='site-head-wide'>
          Find an event
        </a>
        <Show when={location.pathname === '/' && signedOut()}>
          {/* The browser's own jump: the router ignores a second click on the same hash. */}
          <a href='#sign-in' rel='external'>
            Sign in
          </a>
        </Show>
      </nav>
    </header>
  );
}
