import assert from 'node:assert/strict';
import { test } from 'node:test';

import { onRequest } from '../../functions/api/_middleware.ts';

test('Functions responses retain cookies and cache policy while receiving security headers', async () => {
  const original = new Response('private body', {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': 'cm_session=token; HttpOnly; SameSite=Lax',
      Vary: 'Cookie'
    }
  });
  const response = await onRequest({ next: () => Promise.resolve(original) });
  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'private body');
  for (const name of ['Content-Type', 'Cache-Control', 'Set-Cookie', 'Vary']) {
    assert.equal(response.headers.get(name), original.headers.get(name));
  }
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
});

test('redirects and empty responses retain their status and location', async () => {
  for (const status of [204, 302, 304]) {
    const response = await onRequest({
      next: () =>
        Promise.resolve(
          new Response(null, {
            status,
            headers: { Location: '/settings', 'Set-Cookie': 'cm_oauth=; Max-Age=0' }
          })
        )
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Location'), '/settings');
    assert.equal(await response.text(), '');
  }
});
