import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerRequest,
  cancelRequest,
  fileRequest,
  isAnswerFor,
  openDrops,
  publicRequests,
  REQUEST_COOLDOWN_MS,
  requestOf,
  TOO_SOON,
  withRequestIds
} from '../../shared/tournament/requests.ts';

const staff = { by: 'Casey', at: 50 };

/** `fileRequest` where the test expects a new list. */
function filed(...args: Parameters<typeof fileRequest>) {
  const next = fileRequest(...args);
  assert.ok(Array.isArray(next), String(next));
  return next;
}

test('a player holds one request of each kind, and asking again while it is open changes nothing', () => {
  let requests = filed([], { id: 'r1', player: 'p1', kind: 'drop', at: 10 });
  requests = filed(requests, { id: 'r2', player: 'p1', kind: 'staff', at: 11 });
  assert.equal(fileRequest(requests, { id: 'r3', player: 'p1', kind: 'drop', at: 12 }), null);
  const declined = answerRequest(requests, { id: 'r1', status: 'declined', ...staff });
  assert.ok(Array.isArray(declined));
  const again = filed(declined, { id: 'r4', player: 'p1', kind: 'drop', at: 60 });
  assert.deepEqual(requestOf(again, 'p1', 'drop'), { id: 'r4', player: 'p1', kind: 'drop', at: 60, status: 'open' });
  assert.equal(again.length, 2);
});

test('staff answer only the open request they name, with answers that fit its kind', () => {
  const requests = filed(filed([], { id: 'r1', player: 'p1', kind: 'drop', at: 10 }), {
    id: 'r2',
    player: 'p2',
    kind: 'staff',
    at: 11
  });
  assert.equal(isAnswerFor('drop', 'done'), false);
  assert.equal(isAnswerFor('staff', 'accepted'), false);
  assert.equal(typeof answerRequest(requests, { id: 'r1', status: 'done', ...staff }), 'string');
  assert.equal(typeof answerRequest(requests, { id: 'nope', status: 'accepted', ...staff }), 'string');
  const accepted = answerRequest(requests, { id: 'r1', status: 'accepted', ...staff });
  assert.ok(Array.isArray(accepted));
  assert.deepEqual(requestOf(accepted, 'p1', 'drop'), {
    id: 'r1',
    player: 'p1',
    kind: 'drop',
    at: 10,
    status: 'accepted',
    by: 'Casey',
    answeredAt: 50
  });
  assert.equal(typeof answerRequest(accepted, { id: 'r1', status: 'declined', ...staff }), 'string');
});

test('an answer meant for a cancelled request does not land on the one asked after it', () => {
  const first = filed([], { id: 'r1', player: 'p1', kind: 'drop', at: 10 });
  const cancelled = cancelRequest(first, { player: 'p1', kind: 'drop', at: 20 });
  assert.ok(Array.isArray(cancelled));
  const second = filed(cancelled, { id: 'r2', player: 'p1', kind: 'drop', at: 20 + REQUEST_COOLDOWN_MS });
  assert.equal(
    answerRequest(second, { id: 'r1', status: 'accepted', ...staff }),
    'That request was already answered or cancelled'
  );
  assert.ok(Array.isArray(answerRequest(second, { id: 'r2', status: 'accepted', ...staff })));
});

test('a player cancels only an unanswered request, and asks again only after the cooldown', () => {
  const requests = filed([], { id: 'r1', player: 'p1', kind: 'drop', at: 10 });
  const cancelled = cancelRequest(requests, { player: 'p1', kind: 'drop', at: 20 });
  assert.ok(Array.isArray(cancelled));
  assert.equal(requestOf(cancelled, 'p1', 'drop')?.status, 'cancelled');
  assert.equal(typeof cancelRequest(cancelled, { player: 'p1', kind: 'drop', at: 21 }), 'string');
  assert.equal(typeof cancelRequest(requests, { player: 'p1', kind: 'staff', at: 21 }), 'string');
  const ask = (at: number) => fileRequest(cancelled, { id: 'r2', player: 'p1', kind: 'drop', at });
  assert.equal(ask(20 + REQUEST_COOLDOWN_MS - 1), TOO_SOON);
  assert.ok(Array.isArray(ask(20 + REQUEST_COOLDOWN_MS)));
  const answered = answerRequest(requests, { id: 'r1', status: 'declined', ...staff });
  assert.ok(Array.isArray(answered));
  assert.equal(typeof cancelRequest(answered, { player: 'p1', kind: 'drop', at: 30 }), 'string');
  assert.ok(
    Array.isArray(fileRequest(answered, { id: 'r3', player: 'p1', kind: 'drop', at: 31 })),
    'no wait after an answer'
  );
});

test('the public copy keys requests by public key and leaves staff out', () => {
  const requests = answerRequest(
    filed(filed([], { id: 'r1', player: 'p1', kind: 'drop', at: 10 }), {
      id: 'r2',
      player: 'gone',
      kind: 'staff',
      at: 11
    }),
    { id: 'r1', status: 'accepted', ...staff }
  );
  assert.ok(Array.isArray(requests));
  assert.deepEqual(publicRequests(requests, { p1: 'k1' }), [
    { id: 'r1', player: 'k1', kind: 'drop', at: 10, status: 'accepted', answeredAt: 50 }
  ]);
});

test('requests stored without IDs read with one built from what they hold, and IDs already there stand', () => {
  const legacy = { player: 'p1', kind: 'drop' as const, at: 10, status: 'open' as const };
  const [read] = withRequestIds([legacy, { ...legacy, id: 'r9', player: 'p2' }]);
  assert.deepEqual(read, { ...legacy, id: 'legacy:p1:drop:10' });
  assert.deepEqual(withRequestIds([legacy]), withRequestIds([legacy]), 'the same on every read');
  assert.equal(withRequestIds([{ ...legacy, id: 'r9' }])[0]?.id, 'r9');
  assert.ok(
    Array.isArray(answerRequest(withRequestIds([legacy]), { id: 'legacy:p1:drop:10', status: 'accepted', ...staff }))
  );
});

test('the drops waiting on staff are the open ones from the pod’s players, oldest first', () => {
  let requests = filed([], { id: 'r1', player: 'p2', kind: 'drop', at: 20 });
  requests = filed(requests, { id: 'r2', player: 'p1', kind: 'drop', at: 10 });
  requests = filed(requests, { id: 'r3', player: 'p1', kind: 'staff', at: 5 });
  requests = filed(requests, { id: 'r4', player: 'p9', kind: 'drop', at: 1 });
  const answered = answerRequest(requests, { id: 'r1', status: 'declined', ...staff });
  assert.ok(Array.isArray(answered));
  assert.deepEqual(
    openDrops(requests, ['p1', 'p2']).map(request => request.id),
    ['r2', 'r1']
  );
  assert.deepEqual(
    openDrops(answered, ['p1', 'p2']).map(request => request.id),
    ['r2']
  );
});
