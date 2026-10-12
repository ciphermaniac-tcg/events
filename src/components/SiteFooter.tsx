/**
 * The strip under every page: the site's terms and privacy policy, the main
 * site's Feedback and the main site itself, who runs it, and the mode toggle.
 * @module components/SiteFooter
 */

import { For, type JSX } from 'solid-js';
import { A } from '@solidjs/router';
import { MAIN_SITE } from '../lib/constants';
import { type Mode, mode, setMode } from '../lib/theme';

const LINKS: { href: string; label: string }[] = [
  { href: `${MAIN_SITE}/feedback`, label: 'Feedback' },
  { href: MAIN_SITE, label: 'Ciphermaniac' }
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
        <A href='/terms'>Terms</A>
        <A href='/privacy'>Privacy</A>
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
