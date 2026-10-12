import { A } from '@solidjs/router';
import { onMount } from 'solid-js';
import { EmptyState } from '../components/EmptyState';
import { pageTitle } from '../lib/title';

export function NotFoundPage() {
  onMount(() => {
    document.title = pageTitle('Page not found');
  });

  return (
    <section>
      <EmptyState
        title='Page not found'
        mark={<NotFoundMark />}
        actions={
          <A href='/' class='btn btn-primary'>
            Back to home
          </A>
        }
      />
    </section>
  );
}

function NotFoundMark() {
  return (
    <svg
      viewBox='0 0 24 24'
      width='22'
      height='22'
      fill='none'
      stroke='currentColor'
      stroke-width='1.5'
      stroke-linecap='round'
      stroke-linejoin='round'
    >
      <circle cx='12' cy='12' r='9' />
      <path d='M9 9 l6 6 M15 9 l-6 6' />
    </svg>
  );
}
