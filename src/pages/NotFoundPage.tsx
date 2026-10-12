import { A } from '@solidjs/router';
import { onMount } from 'solid-js';
import { ErrorState } from '../components/ErrorState';
import { pageTitle } from '../lib/title';

/** An address that matches nothing here, and the admin page for anyone but an Admin. */
export function NotFoundPage() {
  onMount(() => {
    document.title = pageTitle('Page not found');
  });
  return (
    <ErrorState
      code='404'
      title='Page not found'
      line='This address doesn’t match anything on Ciphermaniac Events. It may have moved, or the link may be mistyped.'
    >
      <A href='/' class='btn btn-primary'>
        Go to your events
      </A>
    </ErrorState>
  );
}
