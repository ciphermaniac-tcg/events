/** Remove persistent player details while keeping the credentials that recover their lists and seats. */
const PROFILE_KEYS = ['cm-tournament-player:', 'cm-tournament-me:'];

/** Where a device keeps the token for the decklist it sent to an event, by the event's code. */
export const DECKLIST_KEY = 'cm-decklist:';

/** Whether this device sent a list to the event, and keeps the token that reads it back. */
export function holdsDecklist(code: string): boolean {
  try {
    return localStorage.getItem(DECKLIST_KEY + code) !== null;
  } catch {
    return false;
  }
}

function keepProfile(key: string, value: string, session: Storage): void {
  try {
    if (session.getItem(key) === null) {
      session.setItem(key, value);
    }
  } catch {
    // Losing transient details must not prevent removing their persistent copy.
  }
}

function migrateDeck(key: string, persistent: Storage, session: Storage): void {
  try {
    const saved = JSON.parse(persistent.getItem(key) ?? 'null') as { token?: unknown; profile?: unknown } | null;
    if (typeof saved?.token !== 'string') {
      persistent.removeItem(key);
      return;
    }
    if (saved.profile !== undefined) {
      keepProfile(key, JSON.stringify(saved.profile), session);
    }
    persistent.setItem(key, JSON.stringify({ token: saved.token }));
  } catch {
    // A storage failure must not discard the credential needed to recover the list.
  }
}

export function migrateEventMemory(persistent: Storage, session: Storage): void {
  const keys = Array.from({ length: persistent.length }, (_, index) => persistent.key(index));
  for (const key of keys) {
    if (key === null) {
      continue;
    }
    if (key.startsWith(DECKLIST_KEY)) {
      migrateDeck(key, persistent, session);
    } else if (PROFILE_KEYS.some(prefix => key.startsWith(prefix))) {
      const value = persistent.getItem(key);
      if (value !== null) {
        keepProfile(key, value, session);
      }
      persistent.removeItem(key);
    }
  }
}

export function initEventMemory(): void {
  try {
    migrateEventMemory(localStorage, sessionStorage);
  } catch {
    // Storage may be disabled; leave migration for the next load where it is available.
  }
}
