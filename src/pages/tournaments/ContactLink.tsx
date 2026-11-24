import { FEEDBACK } from '../../lib/constants';
import { t } from '../../lib/i18n';

/** The way to us when the site can't settle something itself: the main site's feedback page. */
export function ContactLink() {
  return (
    <a class='tm-link-inline' href={FEEDBACK}>
      {t('Contact us')}
    </a>
  );
}
