/**
 * /settings (and the older /account). Signed in: who you are (a small
 * picture or initial, your name, your events, sign out, and which sign-ins
 * are linked), your username, the player profile that decklists and
 * "find my table" fill themselves in from (its name is the one the site
 * calls you by), History: the way to it, whether it is public at
 * /u/<username> and which name it shows, and Organizer: where the account
 * stands on running events, with the way to apply, its events or the admin
 * page, and My data: export, wipe or delete (MyData). A POP ID another account holds is refused, with the way to the
 * feedback form, where an admin settles who holds it. Signed out: one box to
 * sign in.
 */

import { SessionGate } from './SessionGate';
import { SignOutButton } from './SignOutButton';
import { A, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, type JSX, on, Show, untrack } from 'solid-js';
import { displayName, HANDLE_MAX, handleProblem, normalizeHandle } from '../../../shared/accounts/handle';
import { type PlayerProfile, profileErrors } from '../../../shared/tournament/profile';
import {
  ApiError,
  errorText,
  linkUrl,
  type Me,
  type OAuthProvider,
  type Provider,
  saveHandle,
  saveProfile,
  setProfileName,
  setPublicProfile,
  type SignInOffer
} from '../../lib/tournament/api';
import { applicantStage, fetchApplication } from '../../lib/tournament/applications';
import { latestValue } from '../../lib/resource';
import { ApplicantStatus } from './ApplicantStatus';
import { OrganizerRoles } from './OrganizerRoles';
import { Avatar } from './Avatar';
import { MyData } from './MyData';
import { ErrorLine, ResourceFallback } from './Field';
import { emptyProfile, focusFirstProblem, ProfileFields } from './ProfileFields';
import { session, setSession } from './session';
import { SettingRow, Toggle } from './SettingControls';
import { SettingInfo } from './SettingInfo';
import { SignIn } from './SignIn';
import { Trail } from './Trail';
import { ContactLink } from './ContactLink';
import { pageTitle } from '../../lib/title';
import { msg, t } from '../../lib/i18n';
import { ProfileLinksForm } from './ProfileLinksForm';

/**
 * Takes in the fields one save changed, and only those: each answer carries
 * the whole account as its request read it, so an answer landing after
 * another save's would put back what that save changed. The name follows
 * from the profile and username as they now stand.
 */
function mergeUser(user: Me, ...fields: (keyof Me)[]) {
  setSession(prev => {
    if (!prev?.user) {
      return prev;
    }
    const next: Me = { ...prev.user, ...Object.fromEntries(fields.map(field => [field, user[field]])) };
    return { ...prev, user: { ...next, name: displayName(next) } };
  });
}

const PROVIDER_NAMES: Record<OAuthProvider, string> = { google: 'Google', discord: 'Discord' };

/** The sections, in the column's order; the first opens with none asked for. */
const SECTIONS = [
  { id: 'profile', label: msg('Player profile') },
  { id: 'username', label: msg('Username') },
  { id: 'history', label: msg('History') },
  { id: 'links', label: msg('Profile links') },
  { id: 'organizer', label: msg('Organizer') },
  { id: 'data', label: msg('Your data') }
] as const;
type Section = (typeof SECTIONS)[number]['id'];
const readSection = (value: string | undefined): Section =>
  SECTIONS.find(section => section.id === value)?.id ?? 'profile';

/** Who is signed in, at the head of the column: picture, name, username, and the accounts linked or offered. */
function Identity(props: { user: Me; providers: readonly Provider[] }) {
  const offered = () => (['google', 'discord'] as const).filter(provider => props.providers.includes(provider));
  return (
    <div class='tm-settings-who'>
      <Avatar name={props.user.name} src={props.user.avatar} />
      <div>
        <p class='tm-settings-name'>{props.user.name}</p>
        <p class='tm-settings-handle muted'>@{props.user.handle}</p>
      </div>
      <p class='tm-identity-links'>
        <For each={offered()}>
          {provider => (
            <Show
              when={props.user.providers.includes(provider)}
              fallback={
                <a class='tm-link-inline' href={linkUrl(provider)} rel='external'>
                  {t('Link {provider}', { provider: PROVIDER_NAMES[provider] })}
                </a>
              }
            >
              <span class='muted'>{t('{provider} linked', { provider: PROVIDER_NAMES[provider] })}</span>
            </Show>
          )}
        </For>
      </p>
    </div>
  );
}

/** One section, mounted once opened and hidden while another shows, so its unsaved edits survive the switch. */
function Pane(props: { of: Section; current: Section; opened: ReadonlySet<Section>; children: JSX.Element }) {
  return (
    <Show when={props.opened.has(props.of)}>
      <div hidden={props.current !== props.of}>{props.children}</div>
    </Show>
  );
}

/**
 * Signed in: who it is and the sections down the left, the chosen one at
 * right under its name, kept in the address as ?section=.
 */
function SignedIn(props: { user: Me; providers: readonly Provider[] }) {
  const [params, setParams] = useSearchParams<{ section?: string }>();
  const section = () => readSection(params.section);
  const [opened, setOpened] = createSignal<ReadonlySet<Section>>(new Set([untrack(section)]));
  createEffect(() => {
    const now = section();
    setOpened(prev => (prev.has(now) ? prev : new Set([...prev, now])));
  });
  const label = () => t(SECTIONS.find(s => s.id === section())?.label ?? '');
  return (
    <>
      <Trail here={t('Settings')} />
      <div class='tm-side-layout tm-settings-layout'>
        <div class='tm-settings-side'>
          <Identity user={props.user} providers={props.providers} />
          <nav class='tm-side-nav' aria-label={t('Settings')}>
            <For each={SECTIONS}>
              {s => (
                <button
                  type='button'
                  classList={{ 'is-on': s.id === section() }}
                  aria-current={s.id === section() ? 'page' : undefined}
                  onClick={() => setParams({ section: s.id })}
                >
                  {t(s.label)}
                </button>
              )}
            </For>
          </nav>
          <SignOutButton class='btn btn-ghost tm-settings-out' />
        </div>
        <div class='tm-side-content tm-settings-body'>
          <h1 class='tm-settings-title'>{label()}</h1>
          <Pane of='profile' current={section()} opened={opened()}>
            <Profile user={props.user} />
          </Pane>
          <Pane of='username' current={section()} opened={opened()}>
            <Username user={props.user} />
          </Pane>
          <Pane of='history' current={section()} opened={opened()}>
            <HistorySection user={props.user} />
          </Pane>
          <Pane of='links' current={section()} opened={opened()}>
            <ProfileLinksForm />
          </Pane>
          <Pane of='organizer' current={section()} opened={opened()}>
            <OrganizerSection user={props.user} />
          </Pane>
          <Pane of='data' current={section()} opened={opened()}>
            <MyData
              user={props.user}
              onWiped={wiped => mergeUser(wiped, 'handle', 'popId', 'firstName', 'lastName', 'birthDate')}
            />
          </Pane>
        </div>
      </div>
    </>
  );
}

/** The username, checked as it is typed; the server says whether someone else holds it. */
function Username(props: { user: Me }) {
  // eslint-disable-next-line solid/reactivity -- the input edits a copy of the username it opened with
  const [handle, setHandle] = createSignal(props.user.handle);
  const [error, setError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);
  // A wipe hands the account a new username; the input follows it, and only when it changes.
  const current = createMemo(() => props.user.handle);
  createEffect(on(current, next => setHandle(next), { defer: true }));
  const wanted = () => normalizeHandle(handle());
  const problem = () => {
    const found = wanted() === props.user.handle ? null : handleProblem(wanted());
    return found === null ? null : t(found);
  };
  async function save(event: Event) {
    event.preventDefault();
    if (problem()) {
      return;
    }
    try {
      const result = await saveHandle(wanted());
      mergeUser(result.user, 'handle');
      setError(null);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <section>
      <form class='tm-box' onSubmit={event => void save(event)}>
        <div class='tm-box-bar'>
          <input
            class='tm-input tm-grow'
            maxlength={HANDLE_MAX}
            aria-label={t('Username')}
            autocapitalize='none'
            autocomplete='username'
            spellcheck={false}
            aria-invalid={problem() !== null}
            value={handle()}
            onInput={event => {
              setHandle(event.currentTarget.value);
              setError(null);
              setSaved(false);
            }}
          />
          <Show when={saved()}>
            <span class='muted' role='status'>
              {t('Saved')}
            </span>
          </Show>
          <button
            class='btn btn-secondary'
            type='submit'
            disabled={wanted() === props.user.handle || problem() !== null}
          >
            {t('Save username')}
          </button>
        </div>
      </form>
      <ErrorLine message={problem() ?? error()} />
    </section>
  );
}

function Profile(props: { user: Me }) {
  // eslint-disable-next-line solid/reactivity -- the form edits a copy of the profile it opened with
  const [profile, setProfile] = createSignal<PlayerProfile>(emptyProfile(props.user));
  const [touched, setTouched] = createSignal(false);
  const [status, setStatus] = createSignal<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = createSignal<string | null>(null);
  /** Whether the POP ID was refused as another account's, which the feedback form is the way to settle. */
  const [clash, setClash] = createSignal(false);
  createEffect(() => {
    if (!touched()) {
      setProfile(emptyProfile(props.user));
    }
  });
  // A POP ID another account holds is told under the field, with the way to have it settled.
  const problems = () => ({
    ...(touched() ? profileErrors(profile()) : {}),
    ...(clash() ? { popId: error() ?? '' } : {})
  });

  async function save(event: Event) {
    event.preventDefault();
    setTouched(true);
    const refused = profileErrors(profile());
    if (Object.keys(refused).length > 0) {
      focusFirstProblem('settings', refused);
      return;
    }
    setStatus('saving');
    setError(null);
    setClash(false);
    try {
      const { user } = await saveProfile(profile());
      mergeUser(user, 'popId', 'firstName', 'lastName', 'birthDate');
      setStatus('saved');
    } catch (err) {
      setError(errorText(err));
      setClash(err instanceof ApiError && err.body?.popIdTaken === true);
      setStatus('idle');
      if (clash()) {
        focusFirstProblem('settings', { popId: 'taken' });
      }
    }
  }

  return (
    <section>
      <form class='tm-box' onSubmit={event => void save(event)}>
        <div class='tm-box-bar tm-profile-bar'>
          <ProfileFields
            idPrefix='settings'
            value={profile()}
            errors={problems()}
            popIdAction={clash() ? <ContactLink /> : undefined}
            onChange={value => {
              setTouched(true);
              setStatus('idle');
              setClash(false);
              setProfile(value);
            }}
          />
        </div>
        <div class='tm-box-bar tm-set-foot'>
          <Show when={status() === 'saved'}>
            <span class='muted' role='status'>
              {t('Saved')}
            </span>
          </Show>
          <button type='submit' class='btn btn-primary' disabled={status() === 'saving'}>
            {t('Save profile')}
          </button>
        </div>
      </form>
      <ErrorLine message={clash() ? null : error()} />
    </section>
  );
}

/** The public profile's address in full, as it is shared. */
const profileUrl = (handle: string) => `${location.origin}/u/${handle}`;

/**
 * History: the way to it, and the public profile, off unless the account
 * turns it on; on, which name it shows, its link and a way to copy it. The
 * address is the username, so a link shared before works again once the
 * profile is turned back on.
 */
function HistorySection(props: { user: Me }) {
  const [busy, setBusy] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function change(field: 'publicProfile' | 'profileName', ask: () => Promise<{ user: Me }>) {
    if (busy()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user } = await ask();
      mergeUser(user, field);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    await navigator.clipboard.writeText(profileUrl(props.user.handle));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <section>
      <div class='tm-box'>
        <SettingRow label={t('Your history')}>
          <A class='btn btn-secondary' href='/history'>
            {t('View history')}
          </A>
        </SettingRow>
        <SettingRow
          label={t('Public profile')}
          info={<SettingInfo text={t('Enables a public profile page to share your performance at events.')} />}
        >
          <span class='tm-set-inline' aria-busy={busy()}>
            <Toggle
              label={t('Public profile')}
              value={props.user.publicProfile}
              onChange={on => void change('publicProfile', () => setPublicProfile(on))}
            />
          </span>
        </SettingRow>
        <Show when={props.user.publicProfile}>
          <SettingRow
            label={t('Name shown')}
            info={<SettingInfo text={t('Affects only what is shown on your profile page.')} />}
          >
            <span class='tm-set-inline' aria-busy={busy()}>
              <Toggle
                label={t('Name shown')}
                value={props.user.profileName === 'real'}
                on={t('Real name')}
                off={t('Username')}
                onChange={real => void change('profileName', () => setProfileName(real ? 'real' : 'handle'))}
              />
            </span>
          </SettingRow>
          <SettingRow label={t('Profile link')}>
            <span class='tm-set-inline tm-profile-link'>
              <A class='tm-link-inline' href={`/u/${props.user.handle}`}>
                {profileUrl(props.user.handle).replace(/^https?:\/\//, '')}
              </A>
              <button type='button' class='btn btn-secondary' onClick={() => void copy()}>
                {copied() ? t('Copied') : t('Copy')}
              </button>
            </span>
          </SettingRow>
        </Show>
      </div>
      <ErrorLine message={error()} />
    </section>
  );
}

/**
 * Organizer: a store Application pending or not approved (see
 * ApplicantStatus), then every way the account runs events (OrganizerRoles).
 * An account that runs none and has applied for nothing sees only the way to
 * apply.
 */
function OrganizerSection(props: { user: Me }) {
  const [state, { refetch }] = createResource(fetchApplication);
  const current = () => latestValue(state);
  const runs = () => props.user.role !== null || props.user.stores.length > 0;
  /** Only an Application still open or turned down is told apart from the rows below; anything else reads as none. */
  const stage = () => {
    const read = applicantStage(props.user.role, current()?.application ?? null);
    return read === 'pending' || read === 'rejected' ? read : 'none';
  };
  const status = () => stage() !== 'none' || !runs();
  return (
    <section>
      <Show
        when={current() !== undefined}
        fallback={<ResourceFallback resource={state} onRetry={() => void refetch()} height='58px' small />}
      >
        <div class='tm-organizer'>
          <Show when={status()}>
            <ApplicantStatus
              stage={stage()}
              application={current()?.application ?? null}
              onChanged={() => void refetch()}
            />
          </Show>
          <Show when={runs()}>
            <OrganizerRoles user={props.user} applying={stage() !== 'none'} />
          </Show>
        </div>
      </Show>
    </section>
  );
}

/** A page on this site to come back to after signing in; anything else, Settings. */
export function returnTo(next: string | undefined): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/settings';
}

/** Signed out: the way to sign in, back to the page that asked for it (`?next=`). */
function SignedOut(props: { offer: SignInOffer; next: string }) {
  return (
    <>
      <h1 class='tm-settings-title'>{t('Sign in')}</h1>
      <SignIn offer={props.offer} next={props.next} />
    </>
  );
}

export function SettingsPage() {
  const [params] = useSearchParams<{ signin?: string; link?: string; next?: string }>();
  const current = () => latestValue(session);
  createEffect(() => {
    const read = current();
    document.title = pageTitle(read && !read.user ? t('Sign in') : t('Settings'));
  });
  return (
    <div class='tm-page tm-settings'>
      <Show when={params.signin === 'failed'}>
        <p class='tm-error' role='alert'>
          {t('Sign-in didn’t go through. Try again.')}
        </p>
      </Show>
      <Show when={params.signin === 'email'}>
        <p class='tm-error' role='alert'>
          {t('Add and verify an email to sign in with a password.')}
        </p>
      </Show>
      <Show when={params.link === 'used'}>
        <p class='tm-error' role='alert'>
          {t('That account is already linked to another user.')}
        </p>
      </Show>
      <SessionGate>
        {s => (
          <Show when={s().user} fallback={<SignedOut offer={s()} next={returnTo(params.next)} />}>
            {user => <SignedIn user={user()} providers={s().providers} />}
          </Show>
        )}
      </SessionGate>
    </div>
  );
}
