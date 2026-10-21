/**
 * Username and password sign-in through Clerk, from the page's side. Clerk's
 * script comes from the instance's own Frontend API, and only once someone
 * submits the form, so no page carries it otherwise. Clerk checks the
 * password; its session lasts only long enough to take a token, which is
 * posted to /api/auth/clerk as a form, where Clerk's session is ended and the
 * account and its session are ours (functions/api/auth/clerk.ts). Every
 * password account proves an email by a code Clerk sends, at sign-up or, for
 * one made before, at its next sign-in; that email is how a forgotten
 * password is reset.
 */

import { frontendApi, PASSWORD_MIN } from '../../../shared/accounts/clerk';
import { msg, t } from '../i18n';

interface Verification {
  status?: string | null;
  strategy?: string | null;
}

/** An email address on a Clerk user, as its owner adds and proves it. */
interface EmailAddress {
  id: string;
  emailAddress: string;
  verification?: Verification | null;
  prepareVerification: (params: { strategy: 'email_code' }) => Promise<unknown>;
  attemptVerification: (params: { code: string }) => Promise<EmailAddress>;
}

interface ClerkUser {
  primaryEmailAddress?: EmailAddress | null;
  emailAddresses?: EmailAddress[];
  createEmailAddress: (params: { email: string }) => Promise<EmailAddress>;
  update: (params: { primaryEmailAddressId: string }) => Promise<unknown>;
}

interface Attempt {
  status: string | null;
  createdSessionId: string | null;
}

interface Factor {
  strategy: string;
  emailAddressId?: string;
  safeIdentifier?: string;
}

/** A sign-in; its methods update it in place and answer it. */
interface SignInAttempt extends Attempt {
  supportedSecondFactors?: Factor[] | null;
  prepareSecondFactor: (params: { strategy: 'email_code'; emailAddressId: string }) => Promise<unknown>;
  attemptSecondFactor: (params: { strategy: 'email_code'; code: string }) => Promise<SignInAttempt>;
}

interface SignUpAttempt extends Attempt {
  prepareEmailAddressVerification: (params: { strategy: 'email_code' }) => Promise<unknown>;
  attemptEmailAddressVerification: (params: { code: string }) => Promise<SignUpAttempt>;
}

interface SignUpParams {
  username: string;
  emailAddress: string;
  password: string;
}

/** The few parts of Clerk's browser SDK this uses. */
interface ClerkJs {
  load: () => Promise<void>;
  client?: {
    signIn: { create: (params: { identifier: string; password?: string }) => Promise<SignInAttempt> };
    signUp: { create: (params: SignUpParams) => Promise<SignUpAttempt> };
  };
  /** `remove` signs this session out; `signOut` would also navigate away, racing the post. */
  session?: { getToken: () => Promise<string | null>; remove: () => Promise<unknown> } | null;
  user?: ClerkUser | null;
  setActive: (params: { session: string }) => Promise<void>;
}

declare global {
  interface Window {
    Clerk?: ClerkJs;
  }
}

/** Clerk's major version; the instance serves its latest release within it. */
const CLERK_MAJOR = 6;

let loading: Promise<ClerkJs> | null = null;

function injectScript(publishableKey: string): Promise<ClerkJs> {
  const origin = frontendApi(publishableKey);
  if (!origin) {
    return Promise.reject(new Error('Clerk publishable key names no instance'));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${origin}/npm/@clerk/clerk-js@${CLERK_MAJOR}/dist/clerk.browser.js`;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = publishableKey;
    script.addEventListener('load', () =>
      window.Clerk ? resolve(window.Clerk) : reject(new Error('Clerk did not load'))
    );
    script.addEventListener('error', () => reject(new Error('Clerk did not load')));
    document.head.append(script);
  });
}

/** Clerk, loaded once per page; a failed load is tried again next time. */
function loadClerk(publishableKey: string): Promise<ClerkJs> {
  loading ??= injectScript(publishableKey)
    .then(async clerk => {
      await clerk.load();
      return clerk;
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** Starts loading Clerk before it is needed, so the first submit waits on less. */
export function prepareClerk(publishableKey: string): Promise<void> {
  return loadClerk(publishableKey).then(() => undefined);
}

/** Signs Clerk's session out, if there is one; a failure here costs nothing the token needs. */
async function endSession(clerk: ClerkJs): Promise<void> {
  await clerk.session?.remove().catch(() => undefined);
}

/** Signs out the Clerk session a sign-in left waiting on an email, when it is given up. */
export async function abandonSignIn(): Promise<void> {
  const clerk = await loading?.catch(() => null);
  if (clerk) {
    await endSession(clerk);
  }
}

/**
 * Where a step of a password sign-in leads: Clerk's token, ready to post; a
 * code Clerk emailed, to make an account or prove an added email; an email
 * the account has to add before it is in, so a forgotten password can be
 * reset; or a reset code with the new password. A reset says nothing of
 * where its code went, or whether there was anywhere to send one.
 */
export type Step =
  | { kind: 'done'; token: string }
  | { kind: 'code'; to: string; verify: (code: string) => Promise<Step>; resend: () => Promise<void> }
  | { kind: 'email'; add: (email: string) => Promise<Step> }
  | {
      kind: 'reset';
      reset: (code: string, password: string) => Promise<Step>;
      resend: () => Promise<void>;
    };

/** A refusal of this client's own, read as Clerk's are (`clerkProblem`). */
const refusal = (code: string) => ({ errors: [{ code }] });

/** Clerk loaded and its client, with no session left from a sign-in that never finished to refuse another. */
async function ready(publishableKey: string): Promise<{ clerk: ClerkJs; client: NonNullable<ClerkJs['client']> }> {
  const clerk = await loadClerk(publishableKey);
  if (!clerk.client) {
    throw new Error('Clerk has no client');
  }
  await endSession(clerk);
  return { clerk, client: clerk.client };
}

/**
 * Takes the session's token. Clerk's session stays live for the server, which
 * checks it is and then ends it; one left by a post that never arrived is
 * ended before the next sign-in (`ready`).
 */
async function done(clerk: ClerkJs): Promise<Step> {
  const token = await clerk.session?.getToken();
  if (!token) {
    throw new Error('Clerk gave no session token');
  }
  return { kind: 'done', token };
}

const verified = (address: EmailAddress | null | undefined) => address?.verification?.status === 'verified';

/**
 * Whether the user has a verified email to reset a forgotten password by, as
 * the server asks (functions/lib/auth/clerk.ts).
 */
const recoverable = (user: ClerkUser) => verified(user.primaryEmailAddress);

/** Makes the proven address the user's primary one, then takes the token. */
async function makePrimary(clerk: ClerkJs, user: ClerkUser, address: EmailAddress): Promise<Step> {
  await user.update({ primaryEmailAddressId: address.id });
  return done(clerk);
}

/**
 * Adds an email to the signed-in user and sends its code; proving it makes it
 * the primary one. An address the user already has, from an earlier try that
 * never finished, is used again rather than refused as taken.
 */
async function addEmail(clerk: ClerkJs, user: ClerkUser, email: string): Promise<Step> {
  const known = user.emailAddresses?.find(each => each.emailAddress.toLowerCase() === email.toLowerCase());
  const address = known ?? (await user.createEmailAddress({ email }));
  if (verified(address)) {
    return makePrimary(clerk, user, address);
  }
  const resend = () => address.prepareVerification({ strategy: 'email_code' }).then(() => undefined);
  await resend();
  // A retry after the code held, but making it primary failed, does not check the code again.
  const verify = async (code: string) =>
    makePrimary(clerk, user, verified(address) ? address : await address.attemptVerification({ code }));
  return { kind: 'code', to: address.emailAddress, verify, resend };
}

/** Makes the finished attempt's session active: in, unless the user has an email to add first. */
async function settle(clerk: ClerkJs, attempt: Attempt, what: string): Promise<Step> {
  if (attempt.status !== 'complete' || !attempt.createdSessionId) {
    throw new Error(`Clerk ${what} is ${attempt.status ?? 'unfinished'}`);
  }
  await clerk.setActive({ session: attempt.createdSessionId });
  const { user } = clerk;
  return user && !recoverable(user) ? { kind: 'email', add: email => addEmail(clerk, user, email) } : done(clerk);
}

/** Statuses after which Clerk wants a code emailed to the account, as from a device it hasn't seen. */
const SECOND_STEP = new Set(['needs_client_trust', 'needs_second_factor']);

/**
 * A sign-in Clerk wants confirmed by a code to the account's email, from a
 * device it hasn't seen (Client Trust), or settled when it wants nothing more.
 */
async function signedIn(clerk: ClerkJs, attempt: SignInAttempt): Promise<Step> {
  const factor = SECOND_STEP.has(attempt.status ?? '')
    ? attempt.supportedSecondFactors?.find(each => each.strategy === 'email_code')
    : undefined;
  const emailAddressId = factor?.emailAddressId;
  if (!emailAddressId) {
    return settle(clerk, attempt, 'sign-in');
  }
  const resend = () => attempt.prepareSecondFactor({ strategy: 'email_code', emailAddressId }).then(() => undefined);
  await resend();
  const verify = async (code: string) =>
    settle(
      clerk,
      attempt.status === 'complete' ? attempt : await attempt.attemptSecondFactor({ strategy: 'email_code', code }),
      'sign-in'
    );
  return { kind: 'code', to: factor.safeIdentifier ?? '', verify, resend };
}

/** Signs in with a username or email and password. */
export async function passwordSignIn(publishableKey: string, identifier: string, password: string): Promise<Step> {
  const { clerk, client } = await ready(publishableKey);
  return signedIn(clerk, await client.signIn.create({ identifier, password }));
}

export interface NewAccount {
  username: string;
  email: string;
  password: string;
}

/** Makes an account; Clerk emails a code to prove the address before it is in. */
export async function passwordSignUp(publishableKey: string, account: NewAccount): Promise<Step> {
  const { clerk, client } = await ready(publishableKey);
  const { username, email, password } = account;
  const attempt = await client.signUp.create({ username, emailAddress: email, password });
  if (attempt.status !== 'missing_requirements') {
    return settle(clerk, attempt, 'sign-up');
  }
  const resend = () => attempt.prepareEmailAddressVerification({ strategy: 'email_code' }).then(() => undefined);
  await resend();
  // A retry after the code held, but signing in failed, does not check the code again.
  const verify = async (code: string) =>
    settle(
      clerk,
      attempt.status === 'complete' ? attempt : await attempt.attemptEmailAddressVerification({ code }),
      'sign-up'
    );
  return { kind: 'code', to: email, verify, resend };
}

/**
 * One call to our password reset (functions/api/auth/reset); a refusal reads
 * as Clerk's do, by the code the server answers with.
 */
async function resetCall(path: string, body: Record<string, string>): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const answer = (await response.json().catch(() => null)) as { code?: unknown } | null;
    throw refusal(typeof answer?.code === 'string' ? answer.code : 'reset_unavailable');
  }
}

/**
 * Starts a password reset. It goes through our server, never Clerk's sign-in,
 * so nothing the page is told says whether the username or email names
 * anyone: every request answers alike, and a code is emailed only to an
 * account's own verified email. The code and a new password set it; then it
 * signs in with that password as any sign-in does, once, even if a later
 * step is tried again.
 */
export function passwordReset(publishableKey: string, identifier: string): Promise<Step> {
  const ask = () => resetCall('/api/auth/reset', { identifier });
  let set = false;
  const reset = async (code: string, password: string) => {
    if (!set) {
      await resetCall('/api/auth/reset/complete', { code, password });
      set = true;
    }
    return passwordSignIn(publishableKey, identifier, password);
  };
  return ask().then(() => ({ kind: 'reset', reset, resend: ask }));
}

/**
 * Hands the token to /api/auth/clerk as a real form post, so the browser
 * follows the answer as it does a provider's callback. `link` adds the
 * sign-in to the signed-in account.
 */
export function postClerkToken(token: string, next: string, link = false): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/auth/clerk';
  form.hidden = true;
  const fields: [string, string][] = [
    ['token', token],
    ['next', next]
  ];
  if (link) {
    fields.push(['link', '1']);
  }
  for (const [name, value] of fields) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

interface ClerkApiError {
  code?: string;
  longMessage?: string;
  message?: string;
  meta?: { paramName?: string };
}

/** The first error Clerk gave, when it gave one. */
function firstError(error: unknown): ClerkApiError | null {
  const errors = (error as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) && errors.length > 0 ? (errors[0] as ClerkApiError) : null;
}

// Placeholder copy until it is written.
const PROBLEMS = new Map<string, string>([
  ['form_identifier_not_found', msg('Wrong username or password.')],
  ['form_password_incorrect', msg('Wrong username or password.')],
  ['form_identifier_exists', msg('That username is taken.')],
  ['form_identifier_exists:email_address', msg('An account already exists with that email.')],
  ['form_param_format_invalid:email_address', msg('Check the email address.')],
  ['reset_unavailable', msg('Password reset isn’t available right now.')],
  ['reset_in_progress', msg('That code is already being used. Try again in a minute.')],
  ['form_code_incorrect', msg('That code is wrong.')],
  ['verification_expired', msg('That code expired. Send a new one.')],
  ['verification_failed', msg('Too many tries. Send a new code.')],
  ['form_password_pwned', msg('That password has appeared in a data breach. Choose another.')],
  ['form_password_length_too_short', msg('Use at least {n} characters.')],
  ['user_locked', msg('Too many tries. Try again later.')],
  ['too_many_requests', msg('Too many tries. Try again later.')]
]);

/** Ours for Clerk's error: by its code and the field it names (`code:field`), else by its code alone. */
function knownProblem(first: ClerkApiError | null): string | undefined {
  const code = first?.code;
  return code ? (PROBLEMS.get(`${code}:${first.meta?.paramName ?? ''}`) ?? PROBLEMS.get(code)) : undefined;
}

/** What to tell the person when Clerk refused. */
export function clerkProblem(error: unknown): string {
  const first = firstError(error);
  const known = knownProblem(first);
  if (known) {
    return t(known, { n: PASSWORD_MIN });
  }
  return first?.longMessage ?? first?.message ?? t('Sign-in failed. Try again.');
}

/** A field of the form, as Clerk names it. */
const FIELDS = new Map<string, ProblemField>([
  ['username', 'username'],
  ['email_address', 'email'],
  ['password', 'password'],
  ['code', 'code']
]);

/** Refusals that say the username or password was wrong, without telling which: neither field is singled out. */
const EITHER = new Set(['form_identifier_not_found', 'form_password_incorrect']);

export type ProblemField = 'username' | 'email' | 'password' | 'code';

/**
 * A refusal as the form shows it: its words, the one field it is about
 * (null when it is about the whole form), and whether it says an account
 * already has the email, which offers signing in or a reset instead.
 */
export interface Problem {
  text: string;
  field: ProblemField | null;
  emailTaken: boolean;
}

export function problemOf(error: unknown): Problem {
  const first = firstError(error);
  const code = first?.code ?? '';
  const field = EITHER.has(code) ? null : (FIELDS.get(first?.meta?.paramName ?? '') ?? null);
  return {
    text: clerkProblem(error),
    field,
    emailTaken: code === 'form_identifier_exists' && field === 'email'
  };
}
