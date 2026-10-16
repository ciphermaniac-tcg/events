/**
 * My data, at the bottom of Settings: export what the site keeps on the
 * account as a Markdown file, wipe parts of it, or delete the account. Each
 * opens a dialog. Export and wipe both choose from the parts in
 * shared/accounts/myData.ts; a wipe is chosen, then reviewed with what
 * follows from it, before it goes. Deleting asks for the username typed out.
 * A wipe of organizer history or a deletion that must wait says why, with the
 * events still running and the stores still owned.
 */

import { A, useNavigate } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import {
  type DataRefusal,
  EXPORT_PARTS,
  type ExportPart,
  WIPE_PARTS,
  type WipePart
} from '../../../shared/accounts/myData';
import { ApiError, deleteAccount, errorText, exportData, type Me, wipeData } from '../../lib/tournament/api';
import { ErrorLine } from './Field';
import { msg, t, tx } from '../../lib/i18n';
import { Modal } from './Modal';
import { clearSession } from './session';
import { SettingRow } from './SettingControls';
import '../../styles/pages/tournament-store-apply.css';
import '../../styles/pages/tournament-my-data.css';

/** Each part's name and what it holds. */
const PARTS: Record<ExportPart, { name: string; what: string }> = {
  profile: { name: msg('Profile'), what: msg('First and last name, POP ID, birth year') },
  username: { name: msg('Username'), what: msg('Your username, and any you changed from today') },
  events: { name: msg('Event history'), what: msg('The ended events you played in, and which players you were there') },
  organizer: { name: msg('Organizer history'), what: msg('The events you ran or staffed') },
  account: { name: msg('Account'), what: msg('Email, sign-ins, sessions, Applications, stores, badges') }
};

/** What follows from wiping each part. */
const AFTER: Record<WipePart, string[]> = {
  profile: [
    msg('Decklists and “find my table” stop filling themselves in'),
    msg('Sanctioned events leave your history until you add your POP ID again'),
    msg('You can’t apply to organize until the profile is filled in')
  ],
  username: [
    msg('You get a random username'),
    msg('Your old usernames are free for anyone right away'),
    msg('Links to your public profile stop working')
  ],
  events: [
    msg('Ended events leave your history; events still running and ones you play later stay'),
    msg('Organizers keep their own records of the event')
  ],
  organizer: [
    msg('Your name comes off those events; players keep them in their histories'),
    msg('You can no longer open or edit them'),
    msg('Waits until every event you run has ended')
  ]
};

/** What deleting costs. */
const DELETE_AFTER = [
  msg('Everything above is wiped, and your sign-ins and sessions go'),
  msg('Events you ran stay for their players, without your name'),
  msg('Waits until your events have ended and any store you own is handed over')
];

/** The refusal a 409 carries, or null for any other failure. */
const refusalOf = (err: unknown): DataRefusal | null =>
  err instanceof ApiError && err.status === 409 ? (err.body as unknown as DataRefusal) : null;

/** Why a wipe or deletion failed, with what holds it up when it must wait. */
function Failure(props: { error: unknown }) {
  const refusal = () => refusalOf(props.error);
  const holding = () => [
    ...(refusal()?.running.map(event => event.name || event.code) ?? []),
    ...(refusal()?.ownedStores ?? [])
  ];
  return (
    <Show when={props.error}>
      <div class='tm-box-bar tm-modal-body'>
        <ErrorLine message={errorText(props.error)} />
        <Show when={holding().length > 0}>
          <ul class='tm-consequences'>
            <For each={holding()}>{name => <li>{name}</li>}</For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}

/** Checkbox rows for the parts given, ticked as `chosen` says. */
function PartChoices<P extends ExportPart>(props: {
  parts: readonly P[];
  chosen: ReadonlySet<P>;
  onToggle: (part: P) => void;
}) {
  return (
    <For each={props.parts}>
      {part => (
        <label class='tm-choice' classList={{ 'is-on': props.chosen.has(part) }}>
          <input type='checkbox' checked={props.chosen.has(part)} onChange={() => props.onToggle(part)} />
          <span class='tm-choice-text'>
            <strong>{t(PARTS[part].name)}</strong>
            <span>{t(PARTS[part].what)}</span>
          </span>
        </label>
      )}
    </For>
  );
}

/** A set with `part` flipped. */
function toggled<P>(set: ReadonlySet<P>, part: P): Set<P> {
  const next = new Set(set);
  if (!next.delete(part)) {
    next.add(part);
  }
  return next;
}

/** Saves a file the browser was handed, as a download. */
function save(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportDialog(props: { open: boolean; onClose: () => void }) {
  const [chosen, setChosen] = createSignal<ReadonlySet<ExportPart>>(new Set(EXPORT_PARTS));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  function close() {
    setError(null);
    props.onClose();
  }
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { file, name } = await exportData(EXPORT_PARTS.filter(part => chosen().has(part)));
      save(file, name);
      close();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={props.open} title={t('Export data')} onClose={close}>
      <PartChoices parts={EXPORT_PARTS} chosen={chosen()} onToggle={part => setChosen(toggled(chosen(), part))} />
      <Show when={error()}>
        <div class='tm-box-bar'>
          <ErrorLine message={error()} />
        </div>
      </Show>
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={close}>
          {t('Cancel')}
        </button>
        <button
          type='button'
          class='btn btn-primary'
          disabled={chosen().size === 0 || busy()}
          onClick={() => void download()}
        >
          {chosen().size === EXPORT_PARTS.length ? t('Download all') : t('Download')}
        </button>
      </div>
    </Modal>
  );
}

function WipeDialog(props: { open: boolean; onClose: () => void; onWiped: (user: Me) => void }) {
  const [chosen, setChosen] = createSignal<ReadonlySet<WipePart>>(new Set());
  const [reviewing, setReviewing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);
  const parts = () => WIPE_PARTS.filter(part => chosen().has(part));
  function close() {
    setChosen(new Set<WipePart>());
    setReviewing(false);
    setError(null);
    props.onClose();
  }
  async function wipe() {
    setBusy(true);
    setError(null);
    try {
      props.onWiped((await wipeData(parts())).user);
      close();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={props.open} title={t('Wipe data')} onClose={close}>
      <div class='tm-box-bar'>
        <span class='tm-modal-steps'>
          <Show
            when={reviewing()}
            fallback={
              <>
                <b>1 {t('Choose')}</b> · 2 {t('Review')}
              </>
            }
          >
            1 {t('Choose')} · <b>2 {t('Review')}</b>
          </Show>
        </span>
      </div>
      <Show
        when={reviewing()}
        fallback={
          <>
            <PartChoices parts={WIPE_PARTS} chosen={chosen()} onToggle={part => setChosen(toggled(chosen(), part))} />
            <div class='tm-box-bar tm-modal-foot'>
              <button type='button' class='btn btn-ghost' onClick={close}>
                {t('Cancel')}
              </button>
              <button
                type='button'
                class='btn btn-primary'
                disabled={chosen().size === 0}
                onClick={() => setReviewing(true)}
              >
                {t('Review')}
              </button>
            </div>
          </>
        }
      >
        <div class='tm-box-bar tm-modal-body'>
          <ul class='tm-consequences'>
            <For each={parts().flatMap(part => AFTER[part])}>{line => <li>{t(line)}</li>}</For>
          </ul>
        </div>
        <Failure error={error()} />
        <div class='tm-box-bar tm-modal-foot'>
          <button type='button' class='btn btn-ghost' onClick={() => setReviewing(false)}>
            {t('Back')}
          </button>
          <button type='button' class='btn btn-secondary tm-danger' disabled={busy()} onClick={() => void wipe()}>
            {parts().length === WIPE_PARTS.length ? t('Wipe all') : t('Wipe {n}', { n: parts().length })}
          </button>
        </div>
      </Show>
    </Modal>
  );
}

function DeleteDialog(props: { open: boolean; handle: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [typed, setTyped] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);
  function close() {
    setTyped('');
    setError(null);
    props.onClose();
  }
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(typed());
      clearSession();
      navigate('/');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <Modal open={props.open} title={t('Delete your account?')} class='tm-modal-delete' onClose={close}>
      <div class='tm-box-bar tm-modal-body'>
        <ul class='tm-consequences'>
          <For each={DELETE_AFTER}>{line => <li>{t(line)}</li>}</For>
        </ul>
        <label class='tm-field'>
          <span class='tm-label'>{tx('Type {handle} to confirm', { handle: <strong>{props.handle}</strong> })}</span>
          <input
            class='tm-input'
            autocomplete='off'
            autocapitalize='none'
            spellcheck={false}
            value={typed()}
            onInput={event => setTyped(event.currentTarget.value)}
          />
        </label>
      </div>
      <Failure error={error()} />
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={close}>
          {t('Cancel')}
        </button>
        <button
          type='button'
          class='btn btn-secondary tm-danger'
          disabled={typed() !== props.handle || busy()}
          onClick={() => void remove()}
        >
          {t('Delete account')}
        </button>
      </div>
    </Modal>
  );
}

type Open = 'export' | 'wipe' | 'delete' | null;

export function MyData(props: { user: Me; onWiped: (user: Me) => void }) {
  const [open, setOpen] = createSignal<Open>(null);
  const close = () => setOpen(null);
  return (
    <section>
      <div class='tm-box'>
        <SettingRow label={t('Terms of service')}>
          <A class='btn btn-secondary' href='/terms'>
            {t('View terms')}
          </A>
        </SettingRow>
        <SettingRow label={t('Privacy policy')}>
          <A class='btn btn-secondary' href='/privacy'>
            {t('View policy')}
          </A>
        </SettingRow>
        <SettingRow label={t('Export')}>
          <button type='button' class='btn btn-secondary' onClick={() => setOpen('export')}>
            {t('Export data')}
          </button>
        </SettingRow>
        <SettingRow label={t('Wipe data')}>
          <button type='button' class='btn btn-secondary' onClick={() => setOpen('wipe')}>
            {t('Wipe data')}
          </button>
        </SettingRow>
        <SettingRow label={t('Delete account')}>
          <button type='button' class='btn btn-secondary tm-danger' onClick={() => setOpen('delete')}>
            {t('Delete account')}
          </button>
        </SettingRow>
      </div>
      <ExportDialog open={open() === 'export'} onClose={close} />
      <WipeDialog open={open() === 'wipe'} onClose={close} onWiped={user => props.onWiped(user)} />
      <DeleteDialog open={open() === 'delete'} handle={props.user.handle} onClose={close} />
    </section>
  );
}
