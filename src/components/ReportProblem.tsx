import { FEEDBACK } from '../lib/constants';
import { t } from '../lib/i18n';

/** The feedback page, offered quietly beside the ways on from an error the site couldn't recover from. */
export function ReportProblem() {
  return (
    <a class='btn btn-ghost' href={FEEDBACK}>
      {t('Report a problem')}
    </a>
  );
}
