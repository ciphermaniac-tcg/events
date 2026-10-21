import { MAIN_SITE } from '../../lib/constants';
import { t } from '../../lib/i18n';

/** The way to us when the site can't settle something itself: the main site's feedback page. */
export function ContactLink() {
  return (
    <a class='tm-link-inline' href={`${MAIN_SITE}/feedback`}>
      {t('Contact us')}
    </a>
  );
}
