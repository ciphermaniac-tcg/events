import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readCookie, safeNext } from '../../functions/lib/auth/cookies.ts';
import { sameOrigin } from '../../functions/lib/auth/env.ts';

const ORIGIN = 'https://cm.test';

test('sign-in return paths stay on-site after browser normalization', () => {
  for (const path of [
    null,
    'plain',
    '//evil.com',
    '//[',
    '//evil.com:invalid',
    '/..//evil.com',
    '/x/..//evil.com',
    '/%2e%2e//evil.com',
    '/\\evil.com',
    '/\t/evil.com'
  ]) {
    assert.equal(safeNext(path), '/', String(path));
  }
  for (const path of ['/ok/path', '/ok?next=//evil.com#part', '/a/../ok']) {
    const safe = safeNext(path);
    assert.equal(new URL(safe, ORIGIN).origin, ORIGIN);
    assert.equal(safeNext(safe), safe);
  }
});

test('malformed cookies are absent while encoded cookie values still decode', () => {
  for (const value of ['%', '%ZZ', '%E0%A4%A']) {
    assert.equal(readCookie(new Request(ORIGIN, { headers: { cookie: `cm_session=${value}` } }), 'cm_session'), null);
  }
  const request = new Request(ORIGIN, {
    headers: { cookie: 'other=x; cm_oauth=state%20%2Fok%3Fa%3Db; cm_session=abc%3Ddef' }
  });
  assert.equal(readCookie(request, 'cm_oauth'), 'state /ok?a=b');
  assert.equal(readCookie(request, 'cm_session'), 'abc=def');
  assert.equal(readCookie(request, 'missing'), null);
});

test('mutations require an explicit matching Origin; ordinary reads need none', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(sameOrigin(new Request(ORIGIN, { method })), false);
    for (const origin of ['null', 'https://evil.test', `${ORIGIN}.evil.test`]) {
      assert.equal(sameOrigin(new Request(ORIGIN, { method, headers: { origin } })), false);
    }
    assert.equal(sameOrigin(new Request(ORIGIN, { method, headers: { origin: ORIGIN } })), true);
  }
  assert.equal(sameOrigin(new Request(ORIGIN)), true);
  assert.equal(sameOrigin(new Request(ORIGIN, { method: 'HEAD' })), true);
  assert.equal(sameOrigin(new Request(ORIGIN, { headers: { origin: 'null' } })), false);
});
