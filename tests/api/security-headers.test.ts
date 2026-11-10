import assert from 'node:assert/strict';
import { test } from 'node:test';

import { offDomain, onRequest } from '../../functions/api/_middleware.ts';

const request = new Request('https://events.ciphermaniac.com/api/me');

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
  const response = await onRequest({ request, next: () => Promise.resolve(original) });
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
      request,
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

test('the API answers at a Pages address only for the idle sweep', async () => {
  const at = (url: string) => offDomain(new URL(url));
  for (const url of [
    'https://ciphermaniac-events.pages.dev/api/me',
    'https://CIPHERMANIAC-EVENTS.PAGES.DEV/api/tournaments',
    'https://ciphermaniac-events.pages.dev./api/me',
    'https://abc123.ciphermaniac-events.pages.dev/api/tournaments/idle/',
    'https://ciphermaniac-events.pages.dev/api/tournaments/idle2'
  ]) {
    assert.equal(at(url), true, url);
  }
  for (const url of [
    'https://ciphermaniac-events.pages.dev/api/tournaments/idle',
    'https://ciphermaniac-events.pages.dev/api/tournaments/idle?x=1',
    'https://events.ciphermaniac.com/api/me',
    'https://pages.dev.example.com/api/me',
    'http://127.0.0.1:8788/api/me'
  ]) {
    assert.equal(at(url), false, url);
  }
  let reached = false;
  const response = await onRequest({
    request: new Request('https://ciphermaniac-events.pages.dev/api/me'),
    next: () => {
      reached = true;
      return Promise.resolve(new Response('private'));
    }
  });
  assert.equal(response.status, 404);
  assert.equal(reached, false, 'the route never runs');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
});
