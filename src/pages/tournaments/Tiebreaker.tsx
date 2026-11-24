/**
 * OWP and OOWP where players read them, each with what it means behind an
 * info marker. The bubble opens below the label and toward the start, so a
 * table's clipped edge or the last column never cuts it off.
 */

import { InfoTip } from '@ciphermaniac/design/components/InfoTip';
import { msg, t } from '../../lib/i18n';

const MEANS = {
  OWP: msg('Average win percentage of your opponents.'),
  OOWP: msg('Average win percentage of your opponents’ opponents.')
} as const;

export function Tiebreaker(props: { name: keyof typeof MEANS }) {
  return (
    <>
      {props.name}
      <InfoTip
        marker='i'
        class='tm-tip-below'
        label={t('{name}: {meaning}', { name: props.name, meaning: t(MEANS[props.name]) })}
      >
        {t(MEANS[props.name])}
      </InfoTip>
    </>
  );
}
