/**
 * What staff have changed in the console's Settings and not saved yet, per
 * event and per box. Only the fields they changed are kept, each beside the
 * event's own value, so:
 *
 * - leaving for another tab and coming back finds the edits still there;
 * - a field nobody touched follows the event as a colleague changes it, and
 *   does not light up Save;
 * - saving sends the changed fields alone, so it never puts back an older
 *   value of a setting someone else changed meanwhile.
 *
 * Kept for as long as the page is open; a reload starts again from the event.
 */

import { createSignal } from 'solid-js';

export interface SettingsDraft<T extends object> {
  /** The field as the form shows it: the edit, or the event's value when there is none. */
  value: <K extends keyof T>(key: K, saved: T) => T[K];
  /** Takes an edit; one back to the event's value is no edit at all. */
  set: <K extends keyof T>(key: K, value: T[K], saved: T) => void;
  /** The edits that differ from the event as it stands. */
  changes: (saved: T) => Partial<T>;
  /** Drops the edits `sent` saved, keeping any made while it was on its way. */
  forget: (sent: Partial<T>) => void;
}

const drafts = new Map<string, unknown>();

/** The edits in `edits` that `keep` keeps. */
const kept = <T extends object>(edits: Partial<T>, keep: (key: keyof T, value: unknown) => boolean): Partial<T> =>
  Object.fromEntries(Object.entries(edits).filter(([key, value]) => keep(key as keyof T, value))) as Partial<T>;

function createDraft<T extends object>(): SettingsDraft<T> {
  const [edits, setEdits] = createSignal<Partial<T>>({});
  const replace = (next: Partial<T>) => setEdits(() => next);
  return {
    value: (key, saved) => (Object.hasOwn(edits(), key) ? (edits()[key] as T[typeof key]) : saved[key]),
    set(key, value, saved) {
      const others = kept(edits(), other => other !== key);
      replace(value === saved[key] ? others : ({ ...others, [key]: value } as Partial<T>));
    },
    changes: saved => kept(edits(), (key, value) => value !== saved[key]),
    forget: sent => replace(kept(edits(), (key, value) => sent[key] !== value))
  };
}

/** The draft of one box of an event's settings (`box`), made the first time it is asked for. */
export function settingsDraft<T extends object>(code: string, box: string): SettingsDraft<T> {
  const key = `${code}|${box}`;
  const found = (drafts.get(key) as SettingsDraft<T> | undefined) ?? createDraft<T>();
  drafts.set(key, found);
  return found;
}
