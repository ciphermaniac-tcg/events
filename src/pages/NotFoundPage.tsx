import { A } from '@solidjs/router';
import { onMount } from 'solid-js';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';
import { pageTitle } from '../lib/title';
import { t } from '../lib/i18n';
import { MAIN_SITE } from '../lib/constants';

/** An address that matches nothing here, and the admin page for anyone but an Admin. */
export function NotFoundPage() {
  onMount(() => {
    document.title = pageTitle(t('Page not found'));
  });
  return (
    <ErrorState
      code='404'
      title={t('Page not found')}
      line={t(
        'This address doesn’t match anything on Ciphermaniac Events. It may have moved, or the link may be mistyped.'
      )}
    >
      {/* Most who land here followed a mistyped event link. */}
      <a href={`${MAIN_SITE}/tools/event-locator`} class='btn btn-primary'>
        {t('Find an event')}
      </a>
      <A href='/' class='btn btn-secondary'>
        {t('Go home')}
      </A>
    </ErrorState>
  );
}
