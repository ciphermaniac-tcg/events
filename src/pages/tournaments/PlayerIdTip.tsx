/** Where a Player ID comes from, behind an info marker beside the field's label. */

import { InfoTip } from '@ciphermaniac/design/components/InfoTip';
import { t, tx } from '../../lib/i18n';

const SIGN_UP = 'https://club.pokemon.com/us/pokemon-trainer-club/sign-up/';

export function PlayerIdTip() {
  return (
    <InfoTip
      marker='i'
      class='tm-tip-below tm-tip-start'
      // A short name for the marker; the bubble's words describe it (InfoTip ties them in).
      label={t('Where to find it')}
    >
      {tx('Your PLAY! Pokémon ID. {create} or ask your organizer if you don’t have one.', {
        create: (
          <a class='tm-link-inline' href={SIGN_UP} target='_blank' rel='noopener'>
            {t('Create an account')}
          </a>
        )
      })}
    </InfoTip>
  );
}
