/**
 * The desktop app's TOM commands, for the site running in the app's window.
 * The site calls Tauri's own bridge on window rather than taking
 * @tauri-apps/api, so it adds no dependency and loads only inside the app.
 */

import { type Invoke, startRoundTrouble, tomCommands } from '../../../shared/native/tomCommands';
import { categoryCode } from '../../../shared/tournament/tdf';
import type { PodCategory } from '../../../shared/tournament/types';
/**
 * Starts a pod's round in TOM along with the site's clock, so TOM takes the
 * pod's results. Says why when TOM's round did not start; null when it runs.
 */
export async function startTomRound(category: PodCategory): Promise<string | null> {
  try {
    return startRoundTrouble(await nativeTom().startRound(Number(categoryCode(category))));
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
export function nativeTom() {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
  if (!internals) {
    throw new Error('Not in the desktop app');
  }
  return tomCommands(internals.invoke.bind(internals));
}
