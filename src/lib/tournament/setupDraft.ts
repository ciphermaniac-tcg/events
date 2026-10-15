import { type Accessor, createSignal } from 'solid-js';
import type { Tournament } from '../../../shared/tournament/types';

const PREFIX = 'cm-event-setup:';

export const setupDraftKey = (account: string, mode: string, file = '') =>
  `${PREFIX}${encodeURIComponent(account)}:${mode}:${encodeURIComponent(file)}`;

/** FNV-1a over `text`, as eight hex digits: a cheap, stable fingerprint, not a secret. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Which TOM event a setup draft belongs to: its sanction ID, which no other
 * event shares, else the file's own content. Names repeat across events, so
 * two files called the same never restore each other's answers; a file
 * without a sanction ID that TOM has saved since reads as another file.
 */
export const tdfDraftId = (tournament: Tournament): string =>
  tournament.info.sanctionId
    ? `sanction:${tournament.info.sanctionId}`
    : `file:${fingerprint(JSON.stringify(tournament))}`;

function readDraft(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Storage may be disabled; setup remains usable in memory. */
export function clearSetupDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // A successful create must still open its event.
  }
}

/** One account's form fields, saved as they change and recovered on return. */
export function setupDraft(key: string) {
  const saved = readDraft(key);
  return function field<T>(
    name: string,
    fallback: T,
    valid: (value: unknown) => value is T
  ): [Accessor<T>, (value: T) => void] {
    const value = saved[name];
    const [read, write] = createSignal<T>(valid(value) ? value : fallback);
    function update(value: T): void {
      write(() => value);
      saved[name] = value;
      try {
        localStorage.setItem(key, JSON.stringify(saved));
      } catch {
        // Keep the current form working when persistence is unavailable.
      }
    }
    return [read, update];
  };
}
