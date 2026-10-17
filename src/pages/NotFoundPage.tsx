import { A } from '@solidjs/router';
import { onMount } from 'solid-js';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';
import { pageTitle } from '../lib/title';
import { t } from '../lib/i18n';

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
      <A href='/' class='btn btn-primary'>
        {t('Go to your events')}
      </A>
    </ErrorState>
  );
}
