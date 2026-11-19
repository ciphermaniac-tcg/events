/**
 * What staff have changed in the console's Settings and not saved yet, per
 * event and per box. Only the fields they changed are kept, each beside the
 * event's own value, so:
 *
 * - leaving for another tab and coming back finds the edits still there;
 * - a field nobody touched follows the event as a colleague changes it;
 * - saving sends the changed fields alone, so it never puts back an older
 *   value of a setting someone else changed meanwhile;
 * - an edit made from a value a colleague has since changed is not sent over
 *   theirs: it is dropped, and the field shows what they saved.
 *
 * An edit made while a save is on its way is measured against what that save
 * sends, not the event as last read, so switching a setting on and back off
 * before the first answer still sends the second. Saves of one event go one
 * after another however many forms send them (see queueSave).
 *
 * Kept for as long as the page is open; a reload starts again from the event.
 */

import { createSignal } from 'solid-js';

export interface SettingsDraft<T extends object> {
  /** The field as the form shows it: the edit, or the event's value when there is none. */
  value: <K extends keyof T>(key: K, saved: T) => T[K];
  /** Takes an edit; one back to the value standing (the event's, or a save's on its way) is no edit at all. */
  set: <K extends keyof T>(key: K, value: T[K], saved: T) => void;
  /** The edits to send: each that differs from the event, made from the value the event still has. */
  changes: (saved: T) => Partial<T>;
  /** Drops the edits made from a value the event no longer has; whether one of them would have changed it. */
  overtaken: (saved: T) => boolean;
  /** `sent` is on its way, for edits made meanwhile to be measured against. */
  sending: (sent: Partial<T>) => void;
  /** `sent` was answered: once saved (`ok`), its edits go, and any made while it was on its way stay, made from it. */
  settle: (sent: Partial<T>, ok: boolean) => void;
}

/** Each edit, with the event's value it was made from. */
type Edits<T> = { [K in keyof T]?: { value: T[K]; from: T[K] } };

const drafts = new Map<string, unknown>();
const queues = new Map<string, Promise<unknown>>();

const entries = <T>(edits: Edits<T>) =>
  Object.entries(edits) as [keyof T & string, { value: T[keyof T]; from: T[keyof T] }][];

/** The edits that `keep` keeps. */
const kept = <T>(edits: Edits<T>, keep: (key: keyof T, edit: { value: T[keyof T]; from: T[keyof T] }) => boolean) =>
  Object.fromEntries(entries(edits).filter(([key, edit]) => keep(key, edit))) as Edits<T>;

function createDraft<T extends object>(): SettingsDraft<T> {
  const [edits, setEdits] = createSignal<Edits<T>>({});
  const replace = (next: Edits<T>) => setEdits(() => next);
  // What the save on its way sends; empty when none is.
  let flying: Partial<T> = {};
  return {
    value: (key, saved) => {
      const edit = edits()[key];
      return edit ? edit.value : saved[key];
    },
    set(key, value, saved) {
      const edit = edits()[key];
      const from = edit ? edit.from : saved[key];
      const others = kept(edits(), other => other !== key);
      const standing = Object.hasOwn(flying, key) ? flying[key] : saved[key];
      replace(value === standing ? others : { ...others, [key]: { value, from } });
    },
    changes: saved =>
      Object.fromEntries(
        entries(edits())
          .filter(([key, edit]) => edit.value !== saved[key] && edit.from === saved[key])
          .map(([key, edit]) => [key, edit.value])
      ) as Partial<T>,
    overtaken(saved) {
      const gone = entries(edits()).filter(([key, edit]) => edit.from !== saved[key]);
      replace(kept(edits(), key => !gone.some(([other]) => other === key)));
      return gone.some(([key, edit]) => edit.value !== saved[key]);
    },
    sending(sent) {
      flying = sent;
    },
    settle(sent, ok) {
      flying = {};
      if (ok) {
        // An edit made while `sent` was on its way is made from what it saved.
        const moved = entries(edits()).map(([key, edit]) =>
          Object.hasOwn(sent, key)
            ? ([key, { ...edit, from: sent[key] as T[keyof T] }] as const)
            : ([key, edit] as const)
        );
        replace(Object.fromEntries(moved.filter(([, edit]) => edit.value !== edit.from)) as Edits<T>);
      }
    }
  };
}

/** The draft of one box of an event's settings (`box`), made the first time it is asked for. */
export function settingsDraft<T extends object>(code: string, box: string): SettingsDraft<T> {
  const key = `${code}|${box}`;
  const found = (drafts.get(key) as SettingsDraft<T> | undefined) ?? createDraft<T>();
  drafts.set(key, found);
  return found;
}

/** Runs `save` once every save of the event's settings before it is answered, from whichever form sent it. */
export function queueSave(code: string, save: () => Promise<unknown>): void {
  queues.set(code, (queues.get(code) ?? Promise.resolve()).then(save));
}
