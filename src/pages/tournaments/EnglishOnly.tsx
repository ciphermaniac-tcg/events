import { type JSX, Show } from 'solid-js';
import { locale, t } from '../../lib/i18n';

/**
 * Told, in the language shown, that the page below is in English: the terms
 * and privacy policy are Reese's words and stay as written. Nothing in English.
 */
export function EnglishOnly(): JSX.Element {
  return (
    <Show when={locale() !== 'en'}>
      <p class='muted' lang={locale()}>
        {t('This page is available in English only.')}
      </p>
    </Show>
  );
}
