/** TOM's round, started from the console's clock in the desktop app. */

import { startRoundTrouble, type TomEvent } from '../../../shared/native/tomCommands';
import { categoryCode } from '../../../shared/tournament/tdf';
import type { PodCategory } from '../../../shared/tournament/types';
import { nativeTom } from './bridge';

/**
 * Starts a pod's round in TOM along with the site's clock, so TOM takes the
 * pod's results, refused unless TOM has `event` open with the pod on
 * `round`: `event` as the console's sends name it (TomSyncPanel's
 * tomEvent, through RoundControls' startsFor), with the file's source for an event bound to a file without
 * a sanction ID. Says why when TOM's round did not start; null when it runs,
 * when TOM is off on this computer, and when an event without a sanction ID
 * is not yet bound to TOM's file (no `event`).
 */
export async function startTomRound(
  category: PodCategory,
  event: TomEvent | null,
  round: number
): Promise<string | null> {
  try {
    const tom = nativeTom();
    if (!event || !(await tom.state()).on) {
      return null;
    }
    return startRoundTrouble(await tom.startRound(Number(categoryCode(category)), event, round));
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
