/**
 * What a setting does, behind an info marker beside its label (SettingRow's
 * `info`), and the words for each event setting. Apart from SettingControls,
 * which ships with the first page, so the tooltip loads with the pages that
 * use it.
 */

import { InfoTip } from '@ciphermaniac/design/components/InfoTip';
import { msg, t } from '../../lib/i18n';

export const SETTING_INFO = {
  playerReporting: msg('Let players report results from their phones.'),
  agreedReportsSettle: msg(
    'Matching reports from two devices record automatically. Lone reports and disputes still wait for staff.'
  ),
  archetypes: msg('Show player decks once round 1 is paired, or only in final standings.'),
  registration: msg('Let players register on the event’s page. Staff can still add players by hand.'),
  decklists: msg('Accept PTCGL lists. Open lists are public once round 1 is paired; closed lists stay staff-only.'),
  pairing: msg(
    'Where rounds are paired and results are kept. With TOM, you pair and enter results in TOM as usual, and Ciphermaniac shows them to players. With Ciphermaniac, you pair and enter results here, then download the .tdf when the event ends.'
  )
} as const;

/** Player reporting's note, which at a sanctioned event also says where its results go. */
export const reportingInfo = (sanctioned: boolean) =>
  sanctioned
    ? msg('Let players report results from their phones. Results export to .tdf as usual.')
    : SETTING_INFO.playerReporting;

export function SettingInfo(props: { text: string }) {
  return (
    // Below its marker, so a row near the top of the page does not open it under the head bar.
    <InfoTip marker='i' class='tm-tip-below tm-tip-start' label={t(props.text)}>
      {t(props.text)}
    </InfoTip>
  );
}
