/**
 * The Clerk sign-in client (src/lib/tournament/clerk.ts) against a stand-in
 * document and Clerk: the script comes from the key's own Frontend API and
 * only once, a load that fails is tried again, a sign-in or sign-up answers
 * Clerk's token and leaves its session live for the server to check and end,
 * every account proves an email by code before it is in, a forgotten password
 * is reset through our own server, never Clerk's sign-in, the token goes to
 * /api/auth/clerk as a form, and Clerk's refusals read as words.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import {
  abandonSignIn,
  clerkProblem,
  passwordReset,
  passwordSignIn,
  passwordSignUp,
  postClerkToken,
  prepareClerk,
  type Step
} from '../../src/lib/tournament/clerk.ts';

const KEY = `pk_test_${btoa('clerk.cm.test$')}`;

type Listener = () => void;

interface FakeElement {
  tag: string;
  dataset: Record<string, string>;
  listeners: Record<string, Listener>;
  children: FakeElement[];
  [key: string]: unknown;
}

interface Calls {
  scripts: FakeElement[];
  forms: FakeElement[];
  submitted: Record<string, string>[];
  created: { mode: string; params: Record<string, string> }[];
  /** Every other call on Clerk's resources, by name and its parameters. */
  steps: [string, Record<string, unknown>][];
  removed: number;
}

/** How the stand-in Clerk answers; each test sets what it needs. */
interface Behaviour {
  scriptFails: boolean;
  status: string | null;
  signUpStatus: string;
  token: string | null;
  removeFails: boolean;
  refuse: unknown;
  /** Refuses the next code; then takes it. */
  wrongCode: boolean;
  /** Fails the next change of primary email; then makes it. */
  updateFails: boolean;
  /** The user's addresses, kept across sign-ins as Clerk keeps them. */
  addresses: FakeAddress[];
  secondFactors: { strategy: string; emailAddressId?: string; safeIdentifier?: string }[];
  /** How the signed-in user's primary email was proven, if it has one. */
  email: { status: string; strategy: string } | null;
}

let calls: Calls;
let behaviour: Behaviour;
const globals = globalThis as { document?: unknown; window?: unknown };
const before = { document: globals.document, window: globals.window };

function element(tag: string): FakeElement {
  const made: FakeElement = {
    tag,
    dataset: {},
    listeners: {},
    children: [],
    addEventListener(type: string, listener: Listener) {
      made.listeners[type] = listener;
    },
    append(child: FakeElement) {
      made.children.push(child);
    },
    submit() {
      calls.submitted.push(Object.fromEntries(made.children.map(input => [input.name, input.value])) as never);
    }
  };
  return made;
}

function session() {
  return {
    getToken: async () => behaviour.token,
    remove: async () => {
      calls.removed += 1;
      fakeClerk.session = null;
      if (behaviour.removeFails) {
        throw new Error('network');
      }
    }
  };
}

const step = (name: string, params: Record<string, unknown> = {}) => calls.steps.push([name, params]);

/** A code Clerk checks: refused once when `wrongCode` is set. */
function checkCode(name: string, params: Record<string, unknown>) {
  step(name, params);
  if (behaviour.wrongCode) {
    behaviour.wrongCode = false;
    throw Object.assign(new Error('Clerk refused'), { errors: [{ code: 'form_code_incorrect' }] });
  }
}

function refuseIfAsked(mode: string, params: Record<string, string>) {
  calls.created.push({ mode, params });
  if (behaviour.refuse) {
    throw behaviour.refuse;
  }
}

function signInResource(params: Record<string, string>) {
  const resource = {
    status: params.password === undefined ? 'needs_first_factor' : behaviour.status,
    createdSessionId: 'sess_1' as string | null,
    supportedSecondFactors: behaviour.secondFactors,
    prepareSecondFactor: async (prepared: Record<string, unknown>) => step('prepareSecondFactor', prepared),
    attemptSecondFactor: async (attempted: Record<string, unknown>) => {
      checkCode('attemptSecondFactor', attempted);
      resource.status = 'complete';
      return resource;
    }
  };
  return resource;
}

function signUpResource() {
  const resource = {
    status: behaviour.signUpStatus,
    createdSessionId: 'sess_1',
    prepareEmailAddressVerification: async (prepared: Record<string, unknown>) =>
      step('prepareEmailAddressVerification', prepared),
    attemptEmailAddressVerification: async (attempted: Record<string, unknown>) => {
      checkCode('attemptEmailAddressVerification', attempted);
      resource.status = 'complete';
      behaviour.email = { status: 'verified', strategy: 'email_code' };
      return resource;
    }
  };
  return resource;
}

interface FakeAddress {
  id: string;
  emailAddress: string;
  verification: { status: string; strategy: string };
  prepareVerification: (params: Record<string, unknown>) => Promise<void>;
  attemptVerification: (params: Record<string, unknown>) => Promise<FakeAddress>;
}

/** An address on the user, kept across sign-ins as Clerk keeps it; proving it updates it in place. */
function address(email: string): FakeAddress {
  const made: FakeAddress = {
    id: `idn_${behaviour.addresses.length + 2}`,
    emailAddress: email,
    verification: { status: 'unverified', strategy: 'email_code' },
    prepareVerification: async prepared => {
      step('prepareVerification', prepared);
    },
    attemptVerification: async attempted => {
      checkCode('attemptVerification', attempted);
      made.verification = { status: 'verified', strategy: 'email_code' };
      return made;
    }
  };
  return made;
}

function user() {
  return {
    get primaryEmailAddress() {
      return behaviour.email ? { verification: behaviour.email } : null;
    },
    get emailAddresses() {
      return behaviour.addresses;
    },
    createEmailAddress: async ({ email }: { email: string }) => {
      step('createEmailAddress', { email });
      if (behaviour.addresses.some(each => each.emailAddress === email)) {
        throw Object.assign(new Error('Clerk refused'), {
          errors: [{ code: 'form_identifier_exists', meta: { paramName: 'email_address' } }]
        });
      }
      const made = address(email);
      behaviour.addresses.push(made);
      return made;
    },
    update: async (params: Record<string, unknown>) => {
      step('update', params);
      if (behaviour.updateFails) {
        behaviour.updateFails = false;
        throw new Error('network');
      }
      behaviour.email = { status: 'verified', strategy: 'email_code' };
    }
  };
}

const fakeClerk = {
  session: null as ReturnType<typeof session> | null,
  user: null as ReturnType<typeof user> | null,
  load: async () => undefined,
  client: {
    signIn: {
      create: async (params: Record<string, string>) => {
        refuseIfAsked('in', params);
        return signInResource(params);
      }
    },
    signUp: {
      create: async (params: Record<string, string>) => {
        refuseIfAsked('up', params);
        return signUpResource();
      }
    }
  },
  setActive: async () => {
    fakeClerk.session = session();
    fakeClerk.user = user();
  }
};
const fakeWindow: { Clerk?: typeof fakeClerk } = {};

const fakeDocument = {
  createElement: (tag: string) => element(tag),
  head: {
    append(script: FakeElement) {
      calls.scripts.push(script);
      queueMicrotask(() => {
        if (behaviour.scriptFails) {
          script.listeners.error?.();
          return;
        }
        fakeWindow.Clerk = fakeClerk;
        script.listeners.load?.();
      });
    }
  },
  body: {
    append(form: FakeElement) {
      calls.forms.push(form);
    }
  }
};

beforeEach(() => {
  calls = { scripts: [], forms: [], submitted: [], created: [], steps: [], removed: 0 };
  behaviour = {
    scriptFails: false,
    status: 'complete',
    signUpStatus: 'missing_requirements',
    token: 'token-1',
    removeFails: false,
    refuse: null,
    wrongCode: false,
    updateFails: false,
    addresses: [],
    secondFactors: [],
    email: { status: 'verified', strategy: 'email_code' }
  };
  fakeClerk.session = null;
  fakeClerk.user = null;
  Object.assign(globals, { document: fakeDocument, window: fakeWindow });
});

afterEach(() => {
  Object.assign(globals, before);
});

// These run in order: the client keeps Clerk loaded for the page, as it would in a browser.

const signIn = (identifier = 'pat', password = 'pw') => passwordSignIn(KEY, identifier, password);

/** The step's token; fails the test on any other step. */
function tokenOf(answer: Step): string {
  assert.equal(answer.kind, 'done');
  return answer.kind === 'done' ? answer.token : '';
}

function expectKind<K extends Step['kind']>(answer: Step, kind: K): Extract<Step, { kind: K }> {
  assert.equal(answer.kind, kind);
  return answer as Extract<Step, { kind: K }>;
}

test('a key that names no instance loads nothing', async () => {
  await assert.rejects(passwordSignIn('pk_test_nothing', 'pat', 'pw'), /names no instance/);
  assert.equal(calls.scripts.length, 0);
});

test('a script that fails to load is tried again on the next use', async () => {
  behaviour.scriptFails = true;
  await assert.rejects(prepareClerk(KEY), /did not load/);
  behaviour.scriptFails = false;
  await prepareClerk(KEY);
  assert.equal(calls.scripts.length, 2, 'loaded again after the failure');
  const [, script] = calls.scripts;
  assert.equal(script?.src, 'https://clerk.cm.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js');
  assert.equal(script?.dataset.clerkPublishableKey, KEY);
  assert.equal(script?.crossOrigin, 'anonymous');
});

test('Clerk loads once per page', async () => {
  await prepareClerk(KEY);
  await signIn();
  assert.equal(calls.scripts.length, 0);
});

test('signing in answers Clerk’s token and leaves its session live for the server to check and end', async () => {
  assert.equal(tokenOf(await signIn('pat_plays', 'secret')), 'token-1');
  assert.deepEqual(calls.created, [{ mode: 'in', params: { identifier: 'pat_plays', password: 'secret' } }]);
  assert.ok(fakeClerk.session, 'a session signed out first would be refused');
  assert.equal(calls.removed, 0);
  await signIn();
  assert.equal(calls.removed, 1, 'one left by a post that never arrived ends before the next sign-in');
});

test('an account with no verified email adds one by Clerk’s code before it is in', async () => {
  for (const email of [null, { status: 'unverified', strategy: 'email_code' }]) {
    behaviour.email = email;
    behaviour.addresses = [];
    calls.steps = [];
    const adding = expectKind(await signIn(), 'email');
    assert.ok(fakeClerk.session, 'Clerk’s session waits for the email');
    const code = expectKind(await adding.add('pat@example.com'), 'code');
    assert.equal(code.to, 'pat@example.com');
    behaviour.wrongCode = true;
    await assert.rejects(code.verify('000000'), (error: unknown) => clerkProblem(error) === 'That code is wrong.');
    await code.resend();
    assert.equal(tokenOf(await code.verify('123456')), 'token-1');
    assert.deepEqual(calls.steps, [
      ['createEmailAddress', { email: 'pat@example.com' }],
      ['prepareVerification', { strategy: 'email_code' }],
      ['attemptVerification', { code: '000000' }],
      ['prepareVerification', { strategy: 'email_code' }],
      ['attemptVerification', { code: '123456' }],
      ['update', { primaryEmailAddressId: 'idn_2' }]
    ]);
  }
});

test('an email verified another way, as by an admin, is enough to sign in', async () => {
  behaviour.email = { status: 'verified', strategy: 'admin' };
  assert.equal(tokenOf(await signIn()), 'token-1');
});

test('an email added on an earlier try that never finished is used again, not refused as taken', async () => {
  behaviour.email = null;
  const first = expectKind(await signIn(), 'email');
  await first.add('pat@example.com');
  // Given up: the code never entered. The next sign-in adds the same address.
  await abandonSignIn();
  assert.equal(fakeClerk.session, null, 'giving up signs Clerk’s session out');
  const again = expectKind(await signIn(), 'email');
  const code = expectKind(await again.add('Pat@Example.com'), 'code');
  assert.equal(tokenOf(await code.verify('123456')), 'token-1');
  assert.deepEqual(
    calls.steps.map(([name]) => name),
    ['createEmailAddress', 'prepareVerification', 'prepareVerification', 'attemptVerification', 'update']
  );
});

test('an address already proven on an earlier try is made primary without another code', async () => {
  behaviour.email = null;
  const adding = expectKind(await signIn(), 'email');
  const code = expectKind(await adding.add('pat@example.com'), 'code');
  behaviour.updateFails = true;
  await assert.rejects(code.verify('123456'), /network/u);
  assert.equal(tokenOf(await code.verify('123456')), 'token-1', 'the retry does not check the code again');
  await abandonSignIn();
  behaviour.email = null;
  const again = expectKind(await signIn(), 'email');
  assert.equal(tokenOf(await again.add('pat@example.com')), 'token-1', 'a proven address needs no code');
  assert.deepEqual(
    calls.steps.filter(([name]) => name === 'attemptVerification'),
    [['attemptVerification', { code: '123456' }]]
  );
});

test('a sign-in from a device Clerk has not seen is confirmed by a code to the account’s email', async () => {
  behaviour.status = 'needs_client_trust';
  behaviour.secondFactors = [{ strategy: 'email_code', emailAddressId: 'idn_1', safeIdentifier: 'p***@example.com' }];
  const code = expectKind(await signIn(), 'code');
  assert.equal(code.to, 'p***@example.com');
  assert.equal(fakeClerk.session, null, 'not in before the code');
  behaviour.wrongCode = true;
  await assert.rejects(code.verify('000000'));
  assert.equal(tokenOf(await code.verify('123456')), 'token-1');
  assert.deepEqual(calls.steps, [
    ['prepareSecondFactor', { strategy: 'email_code', emailAddressId: 'idn_1' }],
    ['attemptSecondFactor', { strategy: 'email_code', code: '000000' }],
    ['attemptSecondFactor', { strategy: 'email_code', code: '123456' }]
  ]);
  behaviour.secondFactors = [{ strategy: 'totp' }];
  await assert.rejects(signIn(), /needs_client_trust/u, 'a second step it cannot email is refused as before');
});

test('making an account asks for the username and email, and is in once the emailed code holds', async () => {
  const code = expectKind(
    await passwordSignUp(KEY, { username: 'new_player', email: 'new@example.com', password: 'a long passphrase' }),
    'code'
  );
  assert.deepEqual(calls.created, [
    { mode: 'up', params: { username: 'new_player', emailAddress: 'new@example.com', password: 'a long passphrase' } }
  ]);
  assert.equal(code.to, 'new@example.com');
  assert.equal(fakeClerk.session, null, 'no session before the code');
  behaviour.wrongCode = true;
  await assert.rejects(code.verify('000000'));
  behaviour.token = null;
  await assert.rejects(code.verify('123456'), /no session token/u);
  behaviour.token = 'token-1';
  assert.equal(tokenOf(await code.verify('123456')), 'token-1', 'the retry does not check the code again');
  assert.deepEqual(calls.steps, [
    ['prepareEmailAddressVerification', { strategy: 'email_code' }],
    ['attemptEmailAddressVerification', { code: '000000' }],
    ['attemptEmailAddressVerification', { code: '123456' }]
  ]);
});

test('a sign-up Clerk finished without the code still proves the email before it is in', async () => {
  behaviour.signUpStatus = 'complete';
  behaviour.email = null;
  behaviour.addresses = [address('new@example.com')];
  const adding = expectKind(
    await passwordSignUp(KEY, { username: 'new_player', email: 'new@example.com', password: 'a long passphrase' }),
    'email'
  );
  assert.equal(expectKind(await adding.add('new@example.com'), 'code').to, 'new@example.com');
});

/** Our password reset endpoints answering as `answers` says, in turn; what each was sent. */
function resetServer(answers: Record<string, { status: number; body?: unknown }[]>) {
  const sent: [string, Record<string, string>][] = [];
  const fetch = mock.method(globalThis, 'fetch', async (path: string, init?: RequestInit) => {
    sent.push([path, JSON.parse(String(init?.body)) as Record<string, string>]);
    const next = answers[path]?.shift() ?? { status: 200, body: { ok: true } };
    return Response.json(next.body ?? {}, { status: next.status });
  });
  return { sent, restore: () => fetch.mock.restore() };
}

test('a forgotten password goes through our server, never Clerk, until the new password signs in', async () => {
  const server = resetServer({
    '/api/auth/reset': [{ status: 202 }, { status: 202 }],
    '/api/auth/reset/complete': [{ status: 400, body: { code: 'form_code_incorrect' } }, { status: 200 }]
  });
  try {
    const reset = expectKind(await passwordReset(KEY, 'pat_plays'), 'reset');
    assert.deepEqual(Object.keys(reset).sort(), ['kind', 'resend', 'reset'], 'nothing names where a code went');
    await reset.resend();
    await assert.rejects(reset.reset('000000', 'new passphrase'), (error: unknown) => {
      assert.equal(clerkProblem(error), 'That code is wrong.');
      return true;
    });
    assert.deepEqual(calls.created, [], 'Clerk is not asked who the name is');
    assert.equal(tokenOf(await reset.reset('123456', 'new passphrase')), 'token-1');
    assert.deepEqual(server.sent, [
      ['/api/auth/reset', { identifier: 'pat_plays' }],
      ['/api/auth/reset', { identifier: 'pat_plays' }],
      ['/api/auth/reset/complete', { code: '000000', password: 'new passphrase' }],
      ['/api/auth/reset/complete', { code: '123456', password: 'new passphrase' }]
    ]);
    assert.deepEqual(calls.created, [{ mode: 'in', params: { identifier: 'pat_plays', password: 'new passphrase' } }]);
  } finally {
    server.restore();
  }
});

test('a reset whose password was set, but whose sign-in failed, only signs in when tried again', async () => {
  const server = resetServer({});
  try {
    const reset = expectKind(await passwordReset(KEY, 'pat'), 'reset');
    behaviour.refuse = { errors: [{ code: 'too_many_requests' }] };
    await assert.rejects(reset.reset('123456', 'a long passphrase'));
    behaviour.refuse = null;
    assert.equal(tokenOf(await reset.reset('123456', 'a long passphrase')), 'token-1');
    assert.equal(server.sent.filter(([path]) => path === '/api/auth/reset/complete').length, 1);
  } finally {
    server.restore();
  }
});

test('our server refusing a reset reads as words, by the code it answers with', async () => {
  const server = resetServer({
    '/api/auth/reset': [{ status: 503, body: { code: 'reset_unavailable' } }, { status: 500 }],
    '/api/auth/reset/complete': [{ status: 422, body: { code: 'form_password_pwned' } }]
  });
  try {
    await assert.rejects(passwordReset(KEY, 'pat'), (error: unknown) => /isn’t available/u.test(clerkProblem(error)));
    await assert.rejects(passwordReset(KEY, 'pat'), (error: unknown) => /isn’t available/u.test(clerkProblem(error)));
    const reset = expectKind(await passwordReset(KEY, 'pat'), 'reset');
    await assert.rejects(reset.reset('123456', 'password1'), (error: unknown) =>
      /data breach/u.test(clerkProblem(error))
    );
  } finally {
    server.restore();
  }
});

test('a Clerk session left from before is ended first, and ending it may fail without losing the token', async () => {
  fakeClerk.session = session();
  behaviour.removeFails = true;
  assert.equal(tokenOf(await signIn()), 'token-1');
  assert.equal(calls.removed, 1, 'the old session; the new one is the server’s to end');
});

test('a sign-in Clerk has not finished, or one with no token, signs no one in', async () => {
  behaviour.status = 'needs_second_factor';
  await assert.rejects(signIn(), /needs_second_factor/);
  behaviour.status = 'complete';
  behaviour.token = null;
  await assert.rejects(signIn(), /no session token/);
  behaviour.token = 'token-1';
  await signIn();
  assert.equal(calls.removed, 1, 'the session it left ends before the next sign-in');
});

test('Clerk without a client refuses', async () => {
  const { client } = fakeClerk;
  (fakeClerk as { client?: unknown }).client = undefined;
  try {
    await assert.rejects(signIn(), /no client/);
  } finally {
    fakeClerk.client = client;
  }
});

test('the token goes to /api/auth/clerk as a posted form, with the link flag only when linking', () => {
  postClerkToken('token-1', '/host');
  postClerkToken('token-2', '/settings', true);
  const [form] = calls.forms;
  assert.equal(form?.method, 'POST');
  assert.equal(form?.action, '/api/auth/clerk');
  assert.equal(form?.hidden, true);
  assert.ok(form?.children.every(input => input.type === 'hidden'));
  assert.deepEqual(calls.submitted, [
    { token: 'token-1', next: '/host' },
    { token: 'token-2', next: '/settings', link: '1' }
  ]);
});

test('Clerk’s refusals read as words: known codes as ours, others as Clerk’s, anything else as a retry', () => {
  assert.equal(clerkProblem({ errors: [{ code: 'form_password_incorrect' }] }), 'Wrong username or password.');
  assert.equal(clerkProblem({ errors: [{ code: 'form_identifier_exists' }] }), 'That username is taken.');
  assert.equal(
    clerkProblem({ errors: [{ code: 'form_identifier_exists', meta: { paramName: 'email_address' } }] }),
    'An account already exists with that email.',
    'the field Clerk names picks the words'
  );
  assert.equal(
    clerkProblem({ errors: [{ code: 'form_identifier_exists', meta: { paramName: 'username' } }] }),
    'That username is taken.'
  );
  assert.equal(clerkProblem({ errors: [{ code: 'form_password_length_too_short' }] }), 'Use at least 8 characters.');
  assert.equal(
    clerkProblem({ errors: [{ code: 'new_code', longMessage: 'Long words.', message: 'Short' }] }),
    'Long words.'
  );
  assert.equal(clerkProblem({ errors: [{ code: 'new_code', message: 'Short words.' }] }), 'Short words.');
  assert.equal(clerkProblem({ errors: [] }), 'Sign-in failed. Try again.');
  assert.equal(clerkProblem(new Error('network')), 'Sign-in failed. Try again.');
  assert.equal(clerkProblem(null), 'Sign-in failed. Try again.');
});
