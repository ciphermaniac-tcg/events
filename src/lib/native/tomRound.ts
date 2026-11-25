/** TOM's round, started from the console's clock in the desktop app. */

import { startRoundTrouble } from '../../../shared/native/tomCommands';
import { categoryCode } from '../../../shared/tournament/tdf';
import type { PodCategory, TournamentInfo } from '../../../shared/tournament/types';
import { nativeTom, tomEventOf } from './bridge';

/**
 * Starts a pod's round in TOM along with the site's clock, so TOM takes the
 * pod's results, refused unless TOM has `event` open with the pod on
 * `round`, as the event's sends name it (see tomEventOf). Says why when
 * TOM's round did not start; null when it runs, when TOM is off on this
 * computer, and when an event without a sanction ID is not yet bound to
 * TOM's file.
 */
export async function startTomRound(
  category: PodCategory,
  info: TournamentInfo,
  code: string,
  round: number
): Promise<string | null> {
  try {
    const tom = nativeTom();
    const event = tomEventOf(info, code);
    if (!event || !(await tom.state()).on) {
      return null;
    }
    return startRoundTrouble(await tom.startRound(Number(categoryCode(category)), event, round));
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
