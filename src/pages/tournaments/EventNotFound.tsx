import { A } from '@solidjs/router';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';
import { MAIN_SITE } from '../../lib/constants';
import { t } from '../../lib/i18n';

/** An event code that matches no event, on its public page and in the console alike. */
export function EventNotFound(props: { code: string }) {
  return (
    <ErrorState
      code=''
      title={t('Event not found')}
      line={t('No event has code {code}. Check the code with your organizer.', { code: props.code })}
    >
      <A href='/' class='btn btn-primary'>
        {t('Go home')}
      </A>
      <a href={`${MAIN_SITE}/tools/event-locator`} class='btn btn-secondary'>
        {t('Find an event')}
      </a>
    </ErrorState>
  );
}
