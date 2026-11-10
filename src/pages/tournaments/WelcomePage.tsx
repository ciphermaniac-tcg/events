/**
 * /welcome: the age check a new sign-up waits on before it has an account
 * (functions/api/auth/age.ts), with the username and name it may start with.
 * The birth date goes to the server, which keeps the year alone and only for
 * someone 16 or older; anyone younger is told so and nothing about them is
 * kept. Signed in, it is instead the one offer of a username and name to an
 * account made before the age check asked for them (functions/api/me/setup.ts),
 * which "Not now" turns down. Nothing but the birth date is required. Once
 * through, the page goes where sign-in started.
 */

import { A, useLocation } from '@solidjs/router';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { type AccountSetup, ApiError, call, errorText, json, type Me, setUpAccount } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { ownPath } from '../../lib/ownPath';
import { ErrorLine, Field } from './Field';
import { t } from '../../lib/i18n';
import { TournamentHero } from './Hero';
import { session } from './session';
import '../../styles/pages/tournament-welcome.css';

type Stage = 'asking' | 'sending' | 'refused' | 'expired';

/**
 * Where an older account's offer goes once through: the `next` its sign-in
 * set (functions/lib/auth/finish.ts), when it is a path on this site. Only
 * that redirect sets it, so without one the page is the age check, even for
 * a browser still signed in to another account.
 */
function offerNext(next: unknown): string | null {
  if (typeof next !== 'string') {
    return null;
  }
  return ownPath(next) ?? '/';
}

/** The username and name fields, each optional. */
function SetupFields(props: { setup: AccountSetup; onSetup: (setup: AccountSetup) => void }) {
  const set = (key: keyof AccountSetup) => (event: InputEvent & { currentTarget: HTMLInputElement }) =>
    props.onSetup({ ...props.setup, [key]: event.currentTarget.value });
  return (
    <>
      <Field id='welcome-handle' label={t('Username')}>
        <input
          id='welcome-handle'
          class='tm-input tm-welcome-handle'
          autocomplete='username'
          autocapitalize='none'
          spellcheck={false}
          value={props.setup.handle}
          onInput={set('handle')}
        />
      </Field>
      <Field id='welcome-first' label={t('First name')}>
        <input
          id='welcome-first'
          class='tm-input tm-welcome-name'
          autocomplete='given-name'
          value={props.setup.firstName}
          onInput={set('firstName')}
        />
      </Field>
      <Field id='welcome-last' label={t('Last name')}>
        <input
          id='welcome-last'
          class='tm-input tm-welcome-name'
          autocomplete='family-name'
          value={props.setup.lastName}
          onInput={set('lastName')}
        />
      </Field>
    </>
  );
}

function Legal() {
  return (
    <p class='muted tm-welcome-legal'>
      <A href='/terms'>{t('Terms of service')}</A>
      <A href='/privacy'>{t('Privacy policy')}</A>
    </p>
  );
}

/** The age check's answer when it ends the form: too young, or the wait ran out. */
function Answer(props: { stage: Stage; error: string | null }) {
  return (
    <>
      <div class='tm-box-bar'>
        {/* The form, and the button focus was on, are gone: the answer takes focus and is read out. */}
        <p ref={el => queueMicrotask(() => el.focus())} class='tm-welcome-answer' role='alert' tabIndex={-1}>
          {props.error}
        </p>
      </div>
      <Show when={props.stage === 'expired'}>
        <div class='tm-box-bar'>
          <A class='btn btn-secondary' href='/settings'>
            {t('Sign in')}
          </A>
        </div>
      </Show>
    </>
  );
}

function stageFor(err: unknown): Stage {
  const status = err instanceof ApiError ? err.status : 0;
  return status === 403 ? 'refused' : status === 410 ? 'expired' : 'asking';
}

/** A new sign-up: username, name and the age check, which makes the account. */
function NewAccount() {
  const [setup, setSetup] = createSignal<AccountSetup>({ handle: '', firstName: '', lastName: '' });
  const [birthDate, setBirthDate] = createSignal('');
  const [stage, setStage] = createSignal<Stage>('asking');
  const [error, setError] = createSignal<string | null>(null);

  async function send(event: SubmitEvent) {
    event.preventDefault();
    setStage('sending');
    setError(null);
    try {
      const body = { ...setup(), birthDate: birthDate() };
      const { next } = await call<{ next: string }>('/api/auth/age', json('POST', body));
      // A full load, so every part of the page reads the new session.
      window.location.assign(next);
    } catch (err) {
      setStage(stageFor(err));
      setError(errorText(err));
    }
  }

  return (
    <Page title={t('Set up your account')}>
      <Switch>
        <Match when={stage() === 'refused' || stage() === 'expired'}>
          <Answer stage={stage()} error={error()} />
        </Match>
        <Match when={true}>
          <form class='tm-box-bar tm-welcome-form' onSubmit={event => void send(event)}>
            <SetupFields setup={setup()} onSetup={setSetup} />
            <Field id='welcome-birth' label={t('Birth date')}>
              <input
                id='welcome-birth'
                class='tm-input tm-welcome-date'
                type='date'
                required
                autocomplete='bday'
                value={birthDate()}
                onInput={event => setBirthDate(event.currentTarget.value)}
              />
            </Field>
            <div class='tm-welcome-actions'>
              <button type='submit' class='btn btn-primary' disabled={stage() === 'sending' || !birthDate()}>
                {t('Continue')}
              </button>
            </div>
            <ErrorLine message={error()} />
          </form>
        </Match>
      </Switch>
    </Page>
  );
}

/** An older account's one offer of a username and name; "Not now" turns it down for good. */
function ExistingAccount(props: { user: Me; next: string }) {
  // eslint-disable-next-line solid/reactivity -- the form edits a copy of the account it opened with
  const { handle, firstName, lastName } = props.user;
  const [setup, setSetup] = createSignal<AccountSetup>({
    handle,
    firstName: firstName ?? '',
    lastName: lastName ?? ''
  });
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function send(given: AccountSetup | Record<string, never>) {
    setSending(true);
    setError(null);
    try {
      await setUpAccount(given);
      window.location.assign(props.next);
    } catch (err) {
      setSending(false);
      setError(errorText(err));
    }
  }

  return (
    <Page title={t('Finish your account')}>
      <form
        class='tm-box-bar tm-welcome-form'
        onSubmit={event => {
          event.preventDefault();
          void send(setup());
        }}
      >
        <SetupFields setup={setup()} onSetup={setSetup} />
        <div class='tm-welcome-actions'>
          <button type='submit' class='btn btn-primary' disabled={sending()}>
            {t('Save')}
          </button>
          <button type='button' class='btn btn-ghost' disabled={sending()} onClick={() => void send({})}>
            {t('Not now')}
          </button>
        </div>
        <ErrorLine message={error()} />
      </form>
    </Page>
  );
}

function Page(props: { title: string; children: JSX.Element }) {
  return (
    <div class='tm-page tm-narrow'>
      <TournamentHero title={props.title} trail={false} />
      <section class='tm-box'>{props.children}</section>
      <Legal />
    </div>
  );
}

export function WelcomePage() {
  const location = useLocation();
  // Nothing until the session answers, so an older account never glimpses the age check first.
  const offer = () => {
    const answer = latestValue(session);
    const next = offerNext(location.query.next);
    return answer?.user && next ? { user: answer.user, next } : null;
  };
  return (
    <Show when={latestValue(session)}>
      <Show when={offer()} keyed fallback={<NewAccount />}>
        {({ user, next }) => <ExistingAccount user={user} next={next} />}
      </Show>
    </Show>
  );
}
