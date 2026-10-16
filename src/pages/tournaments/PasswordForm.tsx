import {
  type Accessor,
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch
} from 'solid-js';
import { PASSWORD_MIN } from '../../../shared/accounts/clerk';
import { t } from '../../lib/i18n';
import type { Step } from '../../lib/tournament/clerk';

/** The Clerk client, loaded on first use so the pages that only show this form don't carry it. */
const clerkClient = () => import('../../lib/tournament/clerk');
type ClerkClient = Awaited<ReturnType<typeof clerkClient>>;

/** What the form asks for before Clerk has answered: sign in, make an account, or reset a password. */
type Mode = 'in' | 'up' | 'forgot';
/** What Clerk answered that still needs the person: a code, an email to add, or a reset. */
type Pending = Exclude<Step, { kind: 'done' }>;
type PendingOf<K extends Pending['kind']> = Extract<Pending, { kind: K }>;
type Action<T> = (clerk: ClerkClient, publishableKey: string) => Promise<T>;

type Draft = Record<'username' | 'email' | 'password' | 'code', string>;

/** How each part of the form reaches the flow: what was typed, the problem to show, and the way to act. */
interface Flow {
  /** What is typed in the field. */
  field: (name: keyof Draft) => string;
  setField: (name: keyof Draft, value: string) => void;
  problem: Accessor<string | null>;
  busy: Accessor<boolean>;
  /** Asks Clerk, then shows the step it answers, or the problem. */
  run: (action: Action<Step>) => void;
  /** Has Clerk send a code again; true once sent. */
  resend: (send: () => Promise<void>) => Promise<boolean>;
  /** Back to the username and password, or to `mode`. */
  restart: (mode?: Mode) => void;
  /** Starts loading Clerk, when the form first takes focus. */
  warm: () => void;
  /** Whether the first field takes focus when it shows. */
  readonly focus: boolean;
}

interface TextFieldProps {
  flow: Flow;
  name: keyof Draft;
  label: string;
  type?: 'text' | 'email' | 'password';
  autocomplete: string;
  inputmode?: 'numeric' | 'email';
  minLength?: number;
  hint?: string;
  /** The first field of its part, focused as it shows. */
  first?: boolean;
}

/** A labelled field over one of the draft's values, marked when Clerk refused. */
function TextField(props: TextFieldProps) {
  const hintId = createUniqueId();
  let input: HTMLInputElement | undefined;
  onMount(() => {
    if (props.first && props.flow.focus) {
      input?.focus();
    }
  });
  return (
    <label class='tm-field'>
      <span class='tm-label'>{props.label}</span>
      <input
        ref={input}
        class='tm-input'
        type={props.type ?? 'text'}
        name={props.name}
        autocomplete={props.autocomplete}
        inputmode={props.inputmode}
        autocapitalize='none'
        spellcheck={false}
        minLength={props.minLength}
        required
        aria-invalid={props.flow.problem() ? 'true' : undefined}
        aria-describedby={props.hint ? hintId : undefined}
        value={props.flow.field(props.name)}
        onInput={event => props.flow.setField(props.name, event.currentTarget.value)}
      />
      <Show when={props.hint}>
        <span class='tm-signin-hint' id={hintId}>
          {props.hint}
        </span>
      </Show>
    </label>
  );
}

function Problem(props: { flow: Flow }) {
  return (
    <Show when={props.flow.problem()}>
      {text => (
        <p class='tm-error' role='alert'>
          {text()}
        </p>
      )}
    </Show>
  );
}

/** A secondary action under the submit button, set aside while Clerk is busy. */
function Swap(props: { flow: Flow; onClick: () => void; children: JSX.Element }) {
  return (
    <button type='button' class='tm-signin-swap' disabled={props.flow.busy()} onClick={() => props.onClick()}>
      {props.children}
    </button>
  );
}

/** One part of the form: its fields, the problem, then its submit button and the ways out. */
function Part(props: { flow: Flow; submit: string; onSubmit: () => void; acts?: JSX.Element; children: JSX.Element }) {
  return (
    <form
      class='tm-signin-form'
      onFocusIn={() => props.flow.warm()}
      onSubmit={event => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      {props.children}
      <Problem flow={props.flow} />
      <div class='tm-signin-acts'>
        <button type='submit' class='btn btn-primary tm-signin-submit' disabled={props.flow.busy()}>
          {props.submit}
        </button>
        {props.acts}
      </div>
    </form>
  );
}

const trimmed = (flow: Flow, name: keyof Draft) => flow.field(name).trim();

/**
 * The username and password, signing in or making an account. Making one
 * asks for an email too. Clerk's bot check draws into #clerk-captcha, which
 * only the form making an account at that moment holds, so a page with two
 * forms has one.
 */
function Credentials(props: { flow: Flow; mode: 'in' | 'up' }) {
  const making = () => props.mode === 'up';
  function submit() {
    const username = trimmed(props.flow, 'username');
    const password = props.flow.field('password');
    if (making()) {
      const account = { username, email: trimmed(props.flow, 'email'), password };
      props.flow.run((clerk, key) => clerk.passwordSignUp(key, account));
    } else {
      props.flow.run((clerk, key) => clerk.passwordSignIn(key, username, password));
    }
  }
  return (
    <Part
      flow={props.flow}
      submit={making() ? t('Create account') : t('Sign in')}
      onSubmit={submit}
      acts={
        <>
          <Swap flow={props.flow} onClick={() => props.flow.restart(making() ? 'in' : 'up')}>
            {making() ? t('I have an account') : t('Create an account')}
          </Swap>
          <Show when={!making()}>
            <Swap flow={props.flow} onClick={() => props.flow.restart('forgot')}>
              {t('Forgot password?')}
            </Swap>
          </Show>
        </>
      }
    >
      <TextField flow={props.flow} name='username' label={t('Username')} autocomplete='username' first />
      <Show when={making()}>
        <TextField
          flow={props.flow}
          name='email'
          label={t('Email')}
          type='email'
          inputmode='email'
          autocomplete='email'
        />
      </Show>
      <TextField
        flow={props.flow}
        name='password'
        label={t('Password')}
        type='password'
        autocomplete={making() ? 'new-password' : 'current-password'}
        minLength={making() ? PASSWORD_MIN : undefined}
        hint={making() ? t('At least {n} characters', { n: PASSWORD_MIN }) : undefined}
      />
      <Show when={making() && props.flow.busy()}>
        <div id='clerk-captcha' />
      </Show>
    </Part>
  );
}

/** The account to reset, by username or email. */
function Forgot(props: { flow: Flow }) {
  return (
    <Part
      flow={props.flow}
      submit={t('Send code')}
      onSubmit={() => {
        const identifier = trimmed(props.flow, 'username');
        props.flow.run((clerk, key) => clerk.passwordReset(key, identifier));
      }}
      acts={
        <Swap flow={props.flow} onClick={() => props.flow.restart('in')}>
          {t('Back to sign in')}
        </Swap>
      }
    >
      <TextField flow={props.flow} name='username' label={t('Username or email')} autocomplete='username' first />
    </Part>
  );
}

/** Where a code went, and the ways to have it sent again or start over. */
function CodeActs(props: { flow: Flow; resend: () => Promise<void> }) {
  const [sent, setSent] = createSignal(false);
  function resend() {
    void props.flow.resend(props.resend).then(setSent);
  }
  return (
    <>
      <Swap flow={props.flow} onClick={resend}>
        {sent() ? t('Sent again') : t('Send again')}
      </Swap>
      <Swap flow={props.flow} onClick={() => props.flow.restart()}>
        {t('Start over')}
      </Swap>
    </>
  );
}

const sentTo = (to: string) => (to ? t('Sent to {to}', { to }) : undefined);

const oneTime = () =>
  ({ name: 'code', label: t('Code'), autocomplete: 'one-time-code', inputmode: 'numeric' }) as const;

/** The code Clerk emailed, proving an email for a new account or one added at sign-in. */
function Code(props: { flow: Flow; step: PendingOf<'code'> }) {
  return (
    <Part
      flow={props.flow}
      submit={t('Verify')}
      onSubmit={() => {
        const { verify } = props.step;
        const code = trimmed(props.flow, 'code');
        props.flow.run(() => verify(code));
      }}
      acts={<CodeActs flow={props.flow} resend={props.step.resend} />}
    >
      <TextField flow={props.flow} {...oneTime()} hint={sentTo(props.step.to)} first />
    </Part>
  );
}

/** An account made before email was asked for adds one before it is in. */
function AddEmail(props: { flow: Flow; step: PendingOf<'email'> }) {
  return (
    <Part
      flow={props.flow}
      submit={t('Send code')}
      onSubmit={() => {
        const { add } = props.step;
        const email = trimmed(props.flow, 'email');
        props.flow.run(() => add(email));
      }}
      acts={
        <Swap flow={props.flow} onClick={() => props.flow.restart()}>
          {t('Cancel')}
        </Swap>
      }
    >
      {/* Placeholder copy until it is written. */}
      <TextField
        flow={props.flow}
        name='email'
        label={t('Email')}
        type='email'
        inputmode='email'
        autocomplete='email'
        hint={t('Add an email to reset your password with.')}
        first
      />
    </Part>
  );
}

/** The reset code and the new password. */
function Reset(props: { flow: Flow; step: PendingOf<'reset'> }) {
  return (
    <Part
      flow={props.flow}
      submit={t('Reset password')}
      onSubmit={() => {
        const { reset } = props.step;
        const code = trimmed(props.flow, 'code');
        const password = props.flow.field('password');
        props.flow.run(() => reset(code, password));
      }}
      acts={<CodeActs flow={props.flow} resend={props.step.resend} />}
    >
      {/* Placeholder copy until it is written. It says nothing of whether the account exists. */}
      <TextField
        flow={props.flow}
        {...oneTime()}
        hint={t('If the account has an email, a code is on its way.')}
        first
      />
      <TextField
        flow={props.flow}
        name='password'
        label={t('New password')}
        type='password'
        autocomplete='new-password'
        minLength={PASSWORD_MIN}
        hint={t('At least {n} characters', { n: PASSWORD_MIN })}
      />
    </Part>
  );
}

function CredentialsOrForgot(props: { flow: Flow; mode: Mode }) {
  return (
    <Show when={props.mode !== 'forgot'} fallback={<Forgot flow={props.flow} />}>
      <Credentials flow={props.flow} mode={props.mode === 'up' ? 'up' : 'in'} />
    </Show>
  );
}

/** The step Clerk answered, as the part that asks for what it needs; a new step is a new part. */
function StepParts(props: { flow: Flow; step: Pending }) {
  const of = <K extends Pending['kind']>(kind: K) => (props.step.kind === kind ? (props.step as PendingOf<K>) : null);
  return (
    <Switch>
      <Match when={of('code')} keyed>
        {step => <Code flow={props.flow} step={step} />}
      </Match>
      <Match when={of('email')} keyed>
        {step => <AddEmail flow={props.flow} step={step} />}
      </Match>
      <Match when={of('reset')} keyed>
        {step => <Reset flow={props.flow} step={step} />}
      </Match>
    </Switch>
  );
}

/**
 * A username and password, checked by Clerk (lib/tournament/clerk.ts): sign
 * in, make an account, or reset a forgotten password, each through the codes
 * Clerk emails, ending at the page that asked (`next`). Clerk starts loading
 * when the form first takes focus.
 */
export function UsernameForm(props: { publishableKey: string; next: string; focus?: boolean }) {
  const [mode, setMode] = createSignal<Mode>('in');
  const [step, setStep] = createSignal<Pending | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [moved, setMoved] = createSignal(false);
  const [draft, setDraft] = createSignal<Draft>({ username: '', email: '', password: '', code: '' });
  const setField = (name: keyof Draft, value: string) => setDraft(typed => ({ ...typed, [name]: value }));
  let warmed = false;
  function warm() {
    if (!warmed) {
      warmed = true;
      const key = props.publishableKey;
      clerkClient()
        .then(clerk => clerk.prepareClerk(key))
        .catch(() => (warmed = false));
    }
  }
  /** Runs one request to Clerk, busy meanwhile; its answer, or null once the problem shows. */
  async function attempt<T>(action: Action<T>): Promise<{ clerk: ClerkClient; answer: T } | null> {
    setBusy(true);
    setProblem(null);
    const clerk = await clerkClient().catch(() => null);
    try {
      if (!clerk) {
        throw new Error('The sign-in client did not load');
      }
      return { clerk, answer: await action(clerk, props.publishableKey) };
    } catch (error) {
      setProblem(clerk?.clerkProblem(error) ?? t('Sign-in failed. Try again.'));
      setBusy(false);
      return null;
    }
  }
  /** The token goes to the server, busy until the browser leaves; any other step shows. */
  async function run(action: Action<Step>) {
    const result = await attempt(action);
    const answer = result?.answer;
    if (answer?.kind === 'done') {
      result?.clerk.postClerkToken(answer.token, props.next);
    } else if (answer) {
      // A step asks afresh: no code from before, nor the old password as a new one.
      setDraft(typed => ({ ...typed, code: '', password: '' }));
      setMoved(true);
      setStep(answer);
      setBusy(false);
    }
  }
  async function resend(send: () => Promise<void>) {
    const sent = (await attempt(send)) !== null;
    setBusy(false);
    return sent;
  }
  function restart(next = mode()) {
    if (step()) {
      // A sign-in left waiting on an email or code is given up, not left signed in to Clerk.
      void clerkClient().then(clerk => clerk.abandonSignIn());
    }
    setMode(next);
    setStep(null);
    setProblem(null);
    setMoved(true);
  }
  // Back from the page sign-in led to, the browser may restore this one as it was left: busy.
  const restored = (event: PageTransitionEvent) => {
    if (event.persisted) {
      setBusy(false);
      setStep(null);
      setField('password', '');
    }
  };
  onMount(() => window.addEventListener('pageshow', restored));
  onCleanup(() => window.removeEventListener('pageshow', restored));
  const flow: Flow = {
    field: name => draft()[name],
    setField,
    problem,
    busy,
    run: action => void run(action),
    resend,
    restart,
    warm,
    get focus() {
      return moved() || Boolean(props.focus);
    }
  };
  return (
    <Show when={step()} keyed fallback={<CredentialsOrForgot flow={flow} mode={mode()} />}>
      {current => <StepParts flow={flow} step={current} />}
    </Show>
  );
}
