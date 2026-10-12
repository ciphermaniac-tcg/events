import { A } from '@solidjs/router';
import { For } from 'solid-js';
import { MAIN_SITE } from '../lib/constants';

// The main site's sections, linked out to it. Events is this site.
const links: { href: string; label: string }[] = [
  { href: `${MAIN_SITE}/cards`, label: 'Cards' },
  { href: `${MAIN_SITE}/archetypes`, label: 'Archetypes' },
  { href: `${MAIN_SITE}/trends`, label: 'Trends' },
  { href: `${MAIN_SITE}/players`, label: 'Players' },
  { href: `${MAIN_SITE}/tools`, label: 'Tools' }
];

export function TopNav() {
  return (
    <header class='topnav'>
      <a href={MAIN_SITE} class='topnav-word'>
        <img class='topnav-logo' src='/logo.svg' alt='' width='22' height='26' />
        <span>Ciphermaniac</span>
      </a>
      <nav class='topnav-links' aria-label='Primary'>
        <For each={links}>
          {l => (
            <div class='topnav-item'>
              <a href={l.href} class='topnav-link'>
                {l.label}
              </a>
            </div>
          )}
        </For>
        <div class='topnav-item'>
          <A href='/host' class='topnav-link active'>
            Events
          </A>
        </div>
      </nav>
    </header>
  );
}
