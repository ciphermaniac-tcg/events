/**
 * The strip under every page: the site's terms and privacy policy, the main
 * site's Feedback and the main site itself, who runs it, the other language
 * when the visitor reads one, and the mode toggle.
 * @module components/SiteFooter
 */

import { type JSX, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { MAIN_SITE } from '../lib/constants';
import { chooseLocale, offeredLanguage, t } from '../lib/i18n';
import { type Mode, mode, setMode } from '../lib/theme';

/**
 * The other language, named in itself ("Español", "English"), for a visitor
 * whose browser lists it. Nobody else sees it: see `offeredLocale`. A full
 * load rather than a route change, so every string is read again.
 */
function LanguageLink(): JSX.Element {
  const offered = offeredLanguage();
  return (
    <Show when={offered}>
      {language => (
        <a
          href={`?lang=${language().locale}`}
          lang={language().locale}
          hreflang={language().locale}
          onClick={event => {
            event.preventDefault();
            chooseLocale(language().locale);
          }}
        >
          {language().name}
        </a>
      )}
    </Show>
  );
}

export function SiteFooter(): JSX.Element {
  // The button names where it goes, not where you are — so it reads as the
  // thing it does rather than as a state you have to decode. That makes it an
  // action, not a toggle, which is why there is no `aria-pressed` here: a
  // control labelled "Light mode" while pressed would announce a contradiction.
  const next = (): Mode => (mode() === 'dark' ? 'light' : 'dark');
  return (
    <footer class='site-footer'>
      <nav class='site-footer-links' aria-label={t('Footer')}>
        <A href='/terms'>{t('Terms')}</A>
        <A href='/privacy'>{t('Privacy')}</A>
        <a href={`${MAIN_SITE}/feedback`}>{t('Feedback')}</a>
        <a href={MAIN_SITE}>Ciphermaniac</a>
        <LanguageLink />
      </nav>
      <p class='site-footer-note'>
        {t('Maintained by')}{' '}
        <a href='https://x.com/dustoxgDP63' target='_blank' rel='noopener noreferrer'>
          @dustoxgDP63
        </a>
      </p>
      <button
        type='button'
        class='chip'
        aria-label={next() === 'dark' ? t('Switch to dark mode') : t('Switch to light mode')}
        onClick={() => setMode(next())}
      >
        {next() === 'dark' ? t('Dark mode') : t('Light mode')}
      </button>
    </footer>
  );
}
