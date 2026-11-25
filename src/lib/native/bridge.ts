/**
 * The desktop app's TOM commands, for the site running in the app's window.
 * The site calls Tauri's own bridge on window rather than taking
 * @tauri-apps/api, so it adds no dependency and loads only inside the app.
 */

import { type Invoke, tomCommands, type TomEvent } from '../../../shared/native/tomCommands';
import type { TournamentInfo } from '../../../shared/tournament/types';

/** Events without a sanction ID, bound to TOM's file by the organizer; one bound to a file without one too, only until the page closes. */
const bindings = new Map<string, string>();

export function bind(code: string, id: string) {
  bindings.set(code, id);
  try {
    if (id) {
      localStorage.setItem(`cm-tom-event:${code}`, id);
    }
  } catch {
    // Storage refused: the binding holds until the page closes.
  }
}

/**
 * The event as TOM must have it open, for sends and Start Round alike: its
 * sanction ID, or the one its file was bound to; null until an event without
 * one is bound.
 */
export function tomEventOf(info: TournamentInfo, code: string): TomEvent | null {
  let id = info.sanctionId || bindings.get(code);
  try {
    id ??= localStorage.getItem(`cm-tom-event:${code}`) ?? undefined;
  } catch {
    // Storage refused: unbound.
  }
  return id === undefined ? null : { name: info.name, sanctionId: id };
}

export function nativeTom() {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
  if (!internals) {
    throw new Error('Not in the desktop app');
  }
  return tomCommands(internals.invoke.bind(internals));
}
