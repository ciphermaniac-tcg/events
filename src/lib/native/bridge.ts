/**
 * The desktop app's TOM commands, for the site running in the app's window.
 * The site calls Tauri's own bridge on window rather than taking
 * @tauri-apps/api, so it adds no dependency and loads only inside the app.
 */

import { type Invoke, tomCommands } from '../../../shared/native/tomCommands';

export function nativeTom() {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
  if (!internals) {
    throw new Error('Not in the desktop app');
  }
  return tomCommands(internals.invoke.bind(internals));
}
