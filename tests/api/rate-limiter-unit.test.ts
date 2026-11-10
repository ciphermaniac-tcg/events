import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter, rateLimitAddress, resetRateLimiters } from '../../functions/lib/api/rateLimiter.ts';

let now = 0;

beforeEach(() => {
  now = 0;
  mock.method(Date, 'now', () => now);
});

afterEach(() => {
  mock.restoreAll();
});

test('createRateLimiter allows the configured number of requests in a window', () => {
  const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 2 });

  assert.equal(limiter.allows('198.51.100.1'), true);
  assert.equal(limiter.allows('198.51.100.1'), true);
  assert.equal(limiter.allows('198.51.100.1'), false);

  now = 5_001;
  assert.equal(limiter.allows('198.51.100.1'), false);
});

test('an expired window starts fresh without affecting another address', () => {
  const limiter = createRateLimiter({ windowMs: 1_000, maxRequests: 1 });

  assert.equal(limiter.allows('198.51.100.2'), true);
  assert.equal(limiter.allows('198.51.100.2'), false);
  now = 1_001;
  assert.equal(limiter.allows('198.51.100.2'), true);
  assert.equal(limiter.allows('198.51.100.3'), true);
});

test('address churn at capacity cannot reset tracked windows', () => {
  const limiter = createRateLimiter({ maxRequests: 1, maxStoreSize: 2, windowMs: 1_000, cleanupInterval: 1 });
  assert.equal(limiter.allows('first'), true);
  assert.equal(limiter.allows('second'), true);
  for (let index = 0; index < 20; index++) {
    assert.equal(limiter.allows(`new-${index}`), false, 'a new key is refused while the store is full');
    assert.equal(limiter.allows('first'), false);
    assert.equal(limiter.allows('second'), false);
  }
  now = 1_001;
  assert.equal(limiter.allows('new-address'), true);
  assert.equal(limiter.allows('new-address'), false);
});

test('resetRateLimiters clears a live window', () => {
  const limiter = createRateLimiter({ maxRequests: 1 });

  assert.equal(limiter.allows('198.51.100.7'), true);
  assert.equal(limiter.allows('198.51.100.7'), false);
  resetRateLimiters();
  assert.equal(limiter.allows('198.51.100.7'), true);
});

const addressKey = (address: string) =>
  rateLimitAddress(new Request('https://cm.test', { headers: { 'CF-Connecting-IP': address } }));

test('IPv6 interface rotation and equivalent spellings share one /64 window', () => {
  const limiter = createRateLimiter({ maxRequests: 1, maxStoreSize: 2 });
  const addresses = [
    '2001:db8:abcd:1234::1',
    '2001:0DB8:ABCD:1234:0000:0000:0000:0002',
    '2001:db8:abcd:1234:ffff:ffff:ffff:ffff'
  ];
  assert.equal(limiter.allows(addressKey(addresses[0]!)), true);
  for (const address of addresses.slice(1)) {
    assert.equal(limiter.allows(addressKey(address)), false);
  }
  for (let index = 3; index < 10_005; index++) {
    assert.equal(limiter.allows(addressKey(`2001:db8:abcd:1234::${index.toString(16)}`)), false);
  }
  assert.equal(limiter.allows(addressKey('2001:db8:abcd:1235::1')), true, 'a separate network retains its bucket');
  assert.equal(addressKey('2001:db8::1'), addressKey('2001:0db8:0:0:1:2:3:4'));
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
});

test('IPv4 clients and mapped IPv4 clients keep their individual address keys', () => {
  assert.equal(addressKey('192.0.2.1'), '192.0.2.1');
  assert.equal(addressKey('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(addressKey('0:0:0:0:0:FFFF:C000:0201'), '192.0.2.1');
  assert.notEqual(addressKey('::ffff:192.0.2.2'), addressKey('::ffff:192.0.2.1'));
  assert.equal(rateLimitAddress(new Request('https://cm.test')), 'unknown');
  for (const address of ['broken:ip', '2001:::1', 'fe80::1%eth0']) {
    assert.equal(addressKey(address), 'unknown');
  }
});
