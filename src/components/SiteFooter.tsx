/**
 * The strip under every page: where the site goes, who runs it, and the mode
 * toggle.
 *
 * Only the links the nav doesn't carry: the main site's About and Feedback.
 * @module components/SiteFooter
 */

import { For, type JSX } from 'solid-js';
import { MAIN_SITE } from '../lib/constants';
import { type Mode, mode, setMode } from '../lib/theme';

const LINKS: { href: string; label: string }[] = [
  { href: `${MAIN_SITE}/about`, label: 'About' },
  { href: `${MAIN_SITE}/feedback`, label: 'Feedback' }
];

export function SiteFooter(): JSX.Element {
  // The button names where it goes, not where you are — so it reads as the
  // thing it does rather than as a state you have to decode. That makes it an
  // action, not a toggle, which is why there is no `aria-pressed` here: a
  // control labelled "Light mode" while pressed would announce a contradiction.
  const next = (): Mode => (mode() === 'dark' ? 'light' : 'dark');
  return (
    <footer class='site-footer'>
      <nav class='site-footer-links' aria-label='Footer'>
        <For each={LINKS}>{link => <a href={link.href}>{link.label}</a>}</For>
      </nav>
      <p class='site-footer-note'>
        Maintained by{' '}
        <a href='https://x.com/dustoxgDP63' target='_blank' rel='noopener noreferrer'>
          @dustoxgDP63
        </a>
      </p>
      <button type='button' class='chip' aria-label={`Switch to ${next()} mode`} onClick={() => setMode(next())}>
        {next() === 'dark' ? 'Dark' : 'Light'} mode
      </button>
    </footer>
  );
}
