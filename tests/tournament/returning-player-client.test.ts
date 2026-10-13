import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApiError, findReturningPlayers } from '../../src/lib/tournament/api.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('lookup encodes names, uses the current session and passes through cancellation', async () => {
  const controller = new AbortController();
  let called: { path: string; init: RequestInit } | undefined;
  const players = [{ firstName: 'Alex', lastName: 'Morgan', popId: '1234567', birthYear: 1998 }];
  globalThis.fetch = async (input, init = {}) => {
    called = { path: String(input), init };
    return Response.json({ players });
  };
  assert.deepEqual(await findReturningPlayers('ABCDEF', 'Alex & Morgan', controller.signal), { players });
  assert.equal(called?.path, '/api/tournaments/ABCDEF/players?q=Alex+%26+Morgan');
  assert.equal(called?.init.credentials, 'same-origin');
  assert.equal(called?.init.signal?.aborted, false);
  controller.abort();
  assert.equal(called?.init.signal?.aborted, true);
});

test('lookup surfaces server errors without replacing the caller’s cancellation signal', async () => {
  globalThis.fetch = () =>
    Promise.resolve(Response.json({ error: 'Only this event’s staff can do that' }, { status: 403 }));
  await assert.rejects(
    findReturningPlayers('ABCDEF', 'Alex', new AbortController().signal),
    (error: unknown) => error instanceof ApiError && error.status === 403
  );
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = (_input, init) => Promise.reject(init?.signal?.reason);
  await assert.rejects(findReturningPlayers('ABCDEF', 'Alex', controller.signal), { name: 'AbortError' });
});
