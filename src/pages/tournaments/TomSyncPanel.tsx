/**
 * The link between a TOM-run event and the file TOM saves to.
 *
 * TOM pairs every round and keeps every result; the site follows its file.
 * Once linked, the page reads the file whenever TOM saves it and sends the
 * parsed event up if anything changed; nobody uploads anything. How long ago
 * TOM last saved leads the console's head, since what players see is only
 * as fresh as that save, and once a few saves have come in the head says how
 * often TOM saves (see lib/tournament/tomSaves.ts).
 *
 * Results entered on the site wait here until they are written into the
 * file. TOM keeps its own copy in memory and saves over the file, so writing
 * asks first, saying that TOM must be closed and the file reopened after
 * (see lib/tournament/tomLink.ts). The written file is not sent up: the
 * results stay pending on the site until a save of TOM's has them, so a TOM
 * left open that saves over them loses nothing here, and the head says so.
 * After a reload the browser may need permission again; until it has it, the
 * console holds off result entry, since the site can no longer see what TOM
 * has.
 *
 * Each sync names the copy of the event it follows on from, so a browser with
 * an older copy of the file cannot overwrite rounds another one synced: the
 * site refuses it, and the link waits to be reconnected, which replaces the
 * site's copy with this file on purpose, asked first. An upload of a file
 * saved before the site's copy came in asks the same.
 *
 * The link's state lives in createTomLink, shared by the console's head
 * (TomStatus) and the TOM file row on the Settings tab (TomFileRow).
 */

import { createSignal, onCleanup, onMount, Show, untrack } from 'solid-js';
import { olderThan, revisionOf } from '../../../shared/tournament/revision';
import type { Tournament } from '../../../shared/tournament/types';
import type { PendingResult } from '../../../shared/tournament/view';
import { parseTdf } from './tdfReader';
import { ApiError, errorText, type Manage, syncTournament } from '../../lib/tournament/api';
import { tdfFilename, tdfText } from '../../lib/tournament/exportTdf';
import {
  canLinkFiles,
  ensurePermission,
  forgetHandle,
  pickTdf,
  readIfChanged,
  recallHandle,
  recallWrite,
  rememberHandle,
  rememberWrite,
  type TdfHandle,
  writeFile
} from '../../lib/tournament/tomLink';
import { fileTicks } from '../../lib/tournament/fileTicks';
import { autosaveMinutes, minutesSince, savesLate, withSave } from '../../lib/tournament/tomSaves';
import { downloadBlob } from '../../lib/download';
import { intlLocale, msg, t, tn } from '../../lib/i18n';
import { ConfirmAction, ConfirmDialog } from './ConfirmAction';
import { SettingRow } from './SettingControls';

/** 'none' before a file is linked (or on a browser that cannot hold one), 'reconnect' once following stops (see Lapse). */
export type LinkState = 'none' | 'reconnect' | 'watching';

/**
 * Why following the file stopped: the browser's permission to read it
 * lapsed, the file can't be read where it was (moved or deleted), another
 * copy of the event was synced since this one, or the file lacks players or
 * rounds the site's copy has.
 */
export type Lapse = 'permission' | 'unreadable' | 'conflict' | 'older';

/**
 * Where results written into the file stand: 'written' until a save of TOM's
 * comes in, then gone if that save has them, or 'overwritten' if TOM saved
 * over them, still open.
 */
export type WriteState = 'none' | 'written' | 'overwritten';

/** Why a read failed for good: the browser took back permission, or the file was moved or deleted. Null for anything else. */
function lapseOf(err: unknown): Lapse | null {
  if (!(err instanceof DOMException)) {
    return null;
  }
  if (err.name === 'NotAllowedError') {
    return 'permission';
  }
  return err.name === 'NotFoundError' ? 'unreadable' : null;
}

const resultKey = (result: Pick<PendingResult, 'pod' | 'round' | 'table'>) =>
  `${result.pod}:${result.round}:${result.table}`;

const STEP_FAILURES = {
  read: msg('Could not read the .tdf: {error}'),
  parse: msg('Could not parse the .tdf: {error}'),
  send: msg('Could not send the .tdf: {error}')
};

/**
 * Runs one step of following the file. A failure names the step, so the head
 * says whether the file could not be read, did not parse, or was not taken,
 * and keeps what failed as its cause.
 */
async function during<T>(step: keyof typeof STEP_FAILURES, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw new Error(t(STEP_FAILURES[step], { error: errorText(err) }), { cause: err });
  }
}

/**
 * `onSynced` takes the console's new copy of the event when a sync answered
 * with one, and asks for it again when one was refused.
 */
export function createTomLink(props: { manage: () => Manage; onSynced: (answer?: Manage) => Promise<unknown> }) {
  const [handle, setHandle] = createSignal<TdfHandle | null>(null);
  const [state, setState] = createSignal<LinkState>('none');
  const [lapse, setLapse] = createSignal<Lapse>('permission');
  /** Stops following the file until it is reconnected, saying why. */
  const pause = (why: Lapse) => {
    setLapse(why);
    setState('reconnect');
  };
  const [error, setError] = createSignal<string | null>(null);
  /** When TOM saved the file, as its modified times, oldest first. */
  const [saves, setSaves] = createSignal<number[]>([]);
  /** The time the head counts from, moved on with each look at the file. */
  const [now, setNow] = createSignal(Date.now());
  const code = () => props.manage().code;
  // A write made before a reload, or in another tab, is still waiting on TOM.
  const [writeState, setWriteState] = createSignal<WriteState>(
    untrack(() => (recallWrite(code()) ? 'written' : 'none'))
  );
  let lastModified = 0;
  let lastSent = '';
  /** The revision this browser's last sync left; null until it has synced, when the console's copy is the base. */
  let synced: string | null = null;
  /** Whether the organizer chose to replace the site's copy with the file, however old (see stale). */
  let replacing = false;
  let reading = false;
  /** A refresh asked for while a read was under way, done once that read ends. */
  let again = false;
  /** Whether the file as read is the one this browser last wrote, which is no save of TOM's. */
  const ownWrite = (modified: number) => recallWrite(code())?.at === modified;

  /** Starts over from the console's copy: the next read sends the file whatever it holds. */
  function restart() {
    synced = null;
    replacing = false;
    lastModified = 0;
    lastSent = '';
    setSaves([]);
  }

  /**
   * Whether a file read before this browser has synced lacks rounds or
   * results the site's copy has (see olderThan): an older copy, which would
   * replace newer rounds unseen, as an older upload asks first (see UploadButton).
   */
  function stale(parsed: Tournament): boolean {
    return synced === null && !replacing && olderThan(parsed, props.manage().tournament);
  }

  /** Sends the parsed file if it differs from what was last sent; false when it was stale, and following paused. */
  async function push(text: string, force = false): Promise<boolean> {
    const parsed = await during('parse', async () => parseTdf(text));
    const json = JSON.stringify(parsed);
    if (force || json !== lastSent) {
      const base = synced ?? (await revisionOf(props.manage().tournament));
      if (stale(parsed)) {
        pause('older');
        return false;
      }
      const event = code();
      const answer = await during('send', () => syncTournament(event, parsed, base, force).catch(conflicted));
      synced = answer.revision;
      lastSent = json;
      await props.onSynced(answer);
    }
    return true;
  }

  /**
   * Another copy was synced since this one: stop following the file until the
   * organizer reconnects it. Without a linked file, the next upload replaces
   * the copy the console now shows.
   */
  async function conflicted(err: unknown): Promise<never> {
    if (err instanceof ApiError && err.status === 409) {
      restart();
      // Reconnecting replaces the site's copy with the file as it is, a write of this browser's too.
      rememberWrite(code(), null);
      setWriteState('none');
      if (handle()) {
        pause('conflict');
      }
      await props.onSynced();
    }
    throw err;
  }

  /** After a save of TOM's: whether it has the results last written, or TOM saved over them. */
  function settleWrite() {
    const written = recallWrite(code());
    if (!written) {
      // Another tab on the same file settled it first.
      setWriteState(state => (state === 'written' ? 'none' : state));
      return;
    }
    rememberWrite(code(), null);
    const left = props.manage().pending.some(result => written.results.includes(resultKey(result)));
    setWriteState(left ? 'overwritten' : 'none');
  }

  async function readOnce(current: TdfHandle, force: boolean) {
    try {
      const read = await during('read', () => readIfChanged(current, force ? 0 : lastModified));
      // The file as this page wrote it holds the results still pending here: it goes up with TOM's next save.
      if (read && !ownWrite(read.lastModified)) {
        // A stale file is left unread, so reconnecting reads it again and sends it.
        if (!(await push(read.text))) {
          return;
        }
        setSaves(saves => withSave(saves, read.lastModified));
        settleWrite();
      }
      lastModified = read?.lastModified ?? lastModified;
      setError(null);
    } catch (err) {
      // TOM may be halfway through a save, or the site slow to answer; the next look tries again.
      // A file the page may no longer read, or that is gone, will not come back on its own.
      const lost = err instanceof Error ? lapseOf(err.cause) : null;
      if (lost) {
        pause(lost);
      }
      setError(errorText(err));
    }
  }

  async function tick(force = false) {
    setNow(Date.now());
    const current = handle();
    // An ended event takes no copy of the file (see sync.ts); once reopened, the next look reads what TOM saved meanwhile.
    if (!current || state() !== 'watching' || props.manage().settings.finished) {
      return;
    }
    if (reading) {
      // Dropping a refresh here would leave the organizer looking at a button that did nothing.
      again ||= force;
      return;
    }
    reading = true;
    try {
      await readOnce(current, force);
    } finally {
      reading = false;
    }
    if (again) {
      again = false;
      await tick(true);
    }
  }

  async function watch(next: TdfHandle, ask: boolean) {
    setHandle(next);
    const granted = await ensurePermission(next, 'read', ask);
    if (!granted) {
      pause('permission');
      return;
    }
    setState('watching');
    await tick();
  }

  onMount(() => {
    onCleanup(fileTicks(() => void tick()));
    void (async () => {
      const remembered = canLinkFiles() ? await recallHandle(code()) : null;
      if (remembered) {
        await watch(remembered, false);
      }
    })();
  });

  async function link() {
    try {
      const picked = await pickTdf();
      // Remembering only saves picking the file again after a reload; a browser that cannot keep it still follows it.
      await rememberHandle(code(), picked).catch(() => undefined);
      restart();
      await watch(picked, true);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(errorText(err));
      }
    }
  }

  async function unlink() {
    setHandle(null);
    setState('none');
    setSaves([]);
    await forgetHandle(code()).catch(() => undefined);
  }

  async function upload(file: File) {
    try {
      // A manually chosen snapshot replaces automatic following only after its import succeeds.
      await readDone();
      reading = true;
      await push(await file.text(), true);
      await unlink();
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      reading = false;
    }
  }

  /** Waits out a read under way, so its sync cannot land in the middle of a write. */
  const readDone = (): Promise<void> =>
    reading
      ? new Promise<void>(resolve => {
          setTimeout(resolve, 100);
        }).then(readDone)
      : Promise.resolve();

  /**
   * Writes the results entered here into TOM's file as it is now, not as the
   * site last saw it: TOM may have saved since, and that save goes up first.
   */
  async function writeInto(current: TdfHandle) {
    await readDone();
    reading = true;
    try {
      const file = await current.getFile();
      const text = await file.text();
      // Writing again before TOM has saved: the file is this browser's last write, which stays off the site.
      if (!ownWrite(file.lastModified) && !(await push(text))) {
        return;
      }
      const { pending } = props.manage();
      await writeFile(current, tdfText({ tournament: parseTdf(text), pending, finished: false }));
      rememberWrite(code(), { at: (await current.getFile()).lastModified, results: pending.map(resultKey) });
      setWriteState('written');
    } finally {
      reading = false;
    }
  }

  /** Writes the results into the linked file, or without one, downloads the file with them for TOM to open. */
  async function write() {
    const current = handle();
    try {
      if (current && state() === 'watching' && (await ensurePermission(current, 'readwrite', true))) {
        await writeInto(current);
        return;
      }
      const { tournament, pending } = props.manage();
      downloadBlob(
        new Blob([tdfText({ tournament, pending, finished: false })], { type: 'application/xml' }),
        tdfFilename(tournament)
      );
    } catch (err) {
      setError(errorText(err));
    }
  }

  return {
    state,
    fileName: () => handle()?.name ?? '',
    importedAt: () => props.manage().lastImportAt ?? null,
    error,
    pending: () => props.manage().pending.length,
    /** Results can't be entered while the site can't see the file TOM keeps. */
    locked: () => state() === 'reconnect',
    lapse,
    /** When TOM last saved the file this page follows, or null before the first read. */
    savedAt: () => saves().at(-1) ?? null,
    /** How often TOM saves, in minutes, once its saves show it. */
    autosave: () => autosaveMinutes(saves()),
    now,
    finished: () => props.manage().settings.finished,
    writeState,
    refresh: () => tick(true),
    /** Follows the file again: asks for permission again, or for a file that can't be read, has it picked again. */
    reconnect: () => {
      const current = handle();
      if (lapse() === 'unreadable') {
        return link();
      }
      // Asked first (see Reconnect): the file goes up as it is.
      replacing = lapse() === 'conflict' || lapse() === 'older';
      return current ? watch(current, true) : Promise.resolve();
    },
    link,
    unlink,
    upload,
    write
  };
}

export type TomLink = ReturnType<typeof createTomLink>;

/** A time the head names, with its day. */
const dayAndTime = (at: number) =>
  new Date(at).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Uploading a .tdf replaces the site's copy with it, so a file last saved
 * before the site's copy was synced asks first.
 */
function UploadButton(props: { link: TomLink; label: string; class: string }) {
  const [older, setOlder] = createSignal<File | null>(null);
  const take = (file: File) => {
    const synced = props.link.importedAt();
    if (synced !== null && file.lastModified < synced) {
      setOlder(file);
    } else {
      void props.link.upload(file);
    }
  };
  return (
    <>
      <label class={props.class}>
        {props.label}
        <input
          type='file'
          accept='.tdf'
          class='sr-only'
          onChange={e => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            if (file) {
              take(file);
            }
            input.value = '';
          }}
        />
      </label>
      <ConfirmDialog
        open={older() !== null}
        question={t('Replace the site’s copy with {file}?', { file: older()?.name ?? '' })}
        scope={t('The site’s copy was synced at {time}, after {file} was last saved.', {
          time: dayAndTime(props.link.importedAt() ?? 0),
          file: older()?.name ?? ''
        })}
        confirmLabel={t('Replace')}
        danger
        onConfirm={() => {
          const file = older();
          if (file) {
            void props.link.upload(file);
          }
        }}
        onClose={() => setOlder(null)}
      />
    </>
  );
}

/** How long ago TOM saved, in whole minutes. */
function savedAgo(now: number, at: number): string {
  const minutes = minutesSince(now, at);
  if (minutes < 1) {
    return t('Saved by TOM just now');
  }
  return tn(minutes, 'Saved by TOM {n} min ago', 'Saved by TOM {n} min ago');
}

/** The line under the save: what needs doing about written results, or how often TOM saves. */
function SavedNote(props: { link: TomLink; at: number | null; late: boolean }) {
  const time = () =>
    props.at === null ? '' : new Date(props.at).toLocaleTimeString(intlLocale(), { timeStyle: 'short' });
  const every = () => props.link.autosave();
  return (
    <Show
      when={props.link.writeState() === 'none'}
      fallback={
        <small class={props.link.writeState() === 'written' ? 'is-written' : 'is-overwritten'} role='status'>
          {props.link.writeState() === 'written'
            ? t('Results written · reopen the .tdf in TOM')
            : t('TOM saved over the written results')}
        </small>
      }
    >
      <small>
        <Show when={every()} fallback={time()}>
          {minutes => (
            <Show when={props.late} fallback={`${time()} · ${t('TOM saves about every {n} min', { n: minutes() })}`}>
              {t('TOM usually saves every {n} min', { n: minutes() })}
            </Show>
          )}
        </Show>
      </small>
    </Show>
  );
}

/** What the head says of the file once following it stops, by why. */
const LAPSE_LINES: Record<Lapse, string> = {
  permission: msg('{file} needs access again'),
  unreadable: msg('{file} can’t be read'),
  conflict: msg('Another device synced this event'),
  older: msg('{file} is older than the site’s copy')
};

/**
 * When TOM last saved, and how often it does; marigold once TOM has gone two
 * beats without a save. Results written before a reload are waiting on TOM
 * before this page has seen it save, so they show without a save.
 */
function Saved(props: { link: TomLink; lost: boolean }) {
  // An ended event reads no more of the file, so TOM going quiet then says nothing.
  const late = () => {
    const at = props.link.savedAt();
    return (
      at !== null && !props.lost && !props.link.finished() && savesLate(props.link.now(), at, props.link.autosave())
    );
  };
  return (
    <Show when={props.link.savedAt() !== null || props.link.writeState() !== 'none'}>
      <span class='tm-saved' classList={{ 'is-late': late() }}>
        <Show when={props.link.savedAt()}>
          {at => <span class='tm-saved-ago'>{savedAgo(props.link.now(), at())}</span>}
        </Show>
        <Show
          when={!props.lost}
          fallback={<small>{t(LAPSE_LINES[props.link.lapse()], { file: props.link.fileName() })}</small>}
        >
          <SavedNote link={props.link} at={props.link.savedAt()} late={late()} />
        </Show>
      </span>
    </Show>
  );
}

const WRITE_WARNING = msg(
  'Writing replaces the .tdf. Close the event in TOM first, then reopen the .tdf in TOM once it’s written. If TOM is still open, its next save overwrites these results.'
);

/**
 * Writing the results TOM does not have into its file. Writing asks first,
 * in a panel under the button, since TOM must be closed for the write to
 * last; without a linked file, the results download at once.
 */
function WriteResults(props: { link: TomLink }) {
  const [asking, setAsking] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const back = () => {
    setAsking(false);
    queueMicrotask(() => trigger?.focus());
  };
  const watching = () => props.link.state() === 'watching';
  return (
    <span class='tm-write'>
      <button
        ref={el => (trigger = el)}
        type='button'
        class='btn btn-secondary'
        aria-expanded={watching() ? asking() : undefined}
        onClick={() => (watching() ? setAsking(!asking()) : void props.link.write())}
      >
        {watching()
          ? tn(props.link.pending(), 'Write {n} result to .tdf', 'Write {n} results to .tdf')
          : tn(props.link.pending(), 'Download {n} result to .tdf', 'Download {n} results to .tdf')}
      </button>
      <Show when={asking() && watching()}>
        <div
          class='tm-write-ask'
          role='group'
          aria-label={t('Write results to the .tdf')}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              back();
            }
          }}
        >
          <p>{t(WRITE_WARNING)}</p>
          <span class='tm-write-acts'>
            <button type='button' class='btn btn-ghost tm-small' onClick={back}>
              {t('Cancel')}
            </button>
            <button
              type='button'
              class='btn btn-primary tm-small'
              ref={el => queueMicrotask(() => el.focus())}
              onClick={() => {
                back();
                void props.link.write();
              }}
            >
              {t('TOM is closed, write')}
            </button>
          </span>
        </div>
      </Show>
    </span>
  );
}

/** What the head's one button does to follow the file again, by why it stopped. */
const LAPSE_ACTIONS: Record<Lapse, string> = {
  permission: msg('Allow access to {file}'),
  unreadable: msg('Pick {file} again'),
  conflict: msg('Reconnect {file}'),
  older: msg('Reconnect {file}')
};

/**
 * Following the file again. Permission or a file to pick again goes at
 * once; after a conflict, reconnecting replaces the copy another device
 * synced, so it asks first, saying when that copy came in. An older file
 * asks too, saying what it lacks.
 */
function Reconnect(props: { link: TomLink }) {
  const file = () => props.link.fileName();
  const label = () => t(LAPSE_ACTIONS[props.link.lapse()], { file: file() });
  const scope = () =>
    props.link.lapse() === 'older'
      ? t('{file} is missing rounds or results the site’s copy has. Reconnecting replaces the site’s copy with it.', {
          file: file()
        })
      : t(
          'Another device synced this event at {time}. Reconnecting replaces that copy with {file} from this computer.',
          { time: dayAndTime(props.link.importedAt() ?? 0), file: file() }
        );
  return (
    <Show
      when={props.link.lapse() === 'conflict' || props.link.lapse() === 'older'}
      fallback={
        <button type='button' class='btn btn-primary' onClick={() => void props.link.reconnect()}>
          {label()}
        </button>
      }
    >
      <ConfirmAction
        class='btn btn-primary'
        label={label()}
        question={t('Replace the site’s copy with {file}?', { file: file() })}
        scope={scope()}
        confirmLabel={t('Replace')}
        danger
        onConfirm={() => void props.link.reconnect()}
      />
    </Show>
  );
}

/**
 * The console's head for a TOM event: the results TOM does not have yet,
 * then when TOM last saved. A lost file makes following it again the one
 * thing to do; a browser with no file linked offers linking or uploading one.
 */
export function TomStatus(props: { link: TomLink }) {
  const link = () => props.link;
  return (
    <span class='tm-next-acts tm-tom-status'>
      <Show when={link().pending() > 0 && link().state() !== 'reconnect'}>
        <WriteResults link={link()} />
      </Show>
      <Saved link={link()} lost={link().state() === 'reconnect'} />
      <Show when={link().state() === 'reconnect'}>
        <Reconnect link={link()} />
      </Show>
      <Show when={link().state() === 'none'}>
        <Show when={canLinkFiles()}>
          <button type='button' class='btn btn-secondary' onClick={() => void link().link()}>
            {t('Link .tdf file')}
          </button>
        </Show>
        <UploadButton link={link()} label={t('Upload .tdf')} class='btn btn-secondary' />
      </Show>
    </span>
  );
}

const MODES: Record<LinkState, string> = {
  none: msg('Not linked'),
  watching: msg('Following'),
  reconnect: msg('Following paused')
};

/**
 * The file on the Settings tab: which one, and when it was last imported,
 * with reading it again, uploading another or unlinking it. Linking one, or
 * reconnecting it, is the head's (TomStatus).
 */
export function TomFileRow(props: { link: TomLink }) {
  const link = () => props.link;
  return (
    <SettingRow label={t('TOM file')}>
      <span class='tm-set-inline'>
        <span class='tm-file-line'>
          <strong>{t(MODES[link().state()])}</strong>
          <Show when={link().fileName()}>
            <span> · {link().fileName()}</span>
          </Show>
          {/* Events imported before the time was recorded say nothing rather than guess. */}
          <Show when={link().importedAt()}>
            {at => (
              <span class='muted'>
                {' '}
                ·{' '}
                {t('Last imported {time}', {
                  time: new Date(at()).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'medium' })
                })}
              </span>
            )}
          </Show>
          <Show when={!canLinkFiles()}>
            <span class='muted'> · {t('This browser cannot follow files')}</span>
          </Show>
        </span>
        <Show when={link().state() === 'watching'}>
          <button type='button' class='btn btn-secondary tm-small' onClick={() => void link().refresh()}>
            {t('Refresh .tdf')}
          </button>
          <UploadButton link={link()} label={t('Upload a .tdf instead')} class='btn btn-ghost tm-small' />
          <button type='button' class='btn btn-ghost tm-small' onClick={() => void link().unlink()}>
            {t('Unlink file')}
          </button>
        </Show>
      </span>
    </SettingRow>
  );
}
