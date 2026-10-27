/**
 * What a device keeps of the decklist it sent to an event: the token that
 * reads the list back (kept across visits) and who sent it (for the tab
 * only). The event's page asks only whether there is one (holdsDecklist).
 */

import type { PlayerProfile } from '../../../shared/tournament/profile';
import { DECKLIST_KEY } from '../../lib/tournament/sessionMemory';

/** Who sent this device's list, and the token that reads it back. */
export interface Remembered {
  profile: PlayerProfile | null;
  token: string;
}

const memoryKey = (code: string) => DECKLIST_KEY + code;

/** What this page holds where storage refused it (blocked or full), so the list stays this device's to change. */
const page = new Map<string, Remembered>();

export function recall(code: string): Remembered | null {
  const held = page.get(code);
  if (held) {
    return held;
  }
  try {
    const stored = JSON.parse(localStorage.getItem(memoryKey(code)) ?? 'null') as { token: string } | null;
    const profile = JSON.parse(sessionStorage.getItem(memoryKey(code)) ?? 'null') as PlayerProfile | null;
    return stored?.token ? { profile, token: stored.token } : null;
  } catch {
    return null;
  }
}

export function remember(code: string, value: Remembered | null) {
  page.delete(code);
  try {
    if (value) {
      localStorage.setItem(memoryKey(code), JSON.stringify({ token: value.token }));
      sessionStorage.setItem(memoryKey(code), JSON.stringify(value.profile));
    } else {
      sessionStorage.removeItem(memoryKey(code));
      localStorage.removeItem(memoryKey(code));
    }
  } catch {
    if (value) {
      page.set(code, value);
    }
  }
}
