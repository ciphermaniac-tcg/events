import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter, rateLimitAddress } from '../../functions/lib/api/rateLimiter.ts';

let now = 0;

beforeEach(() => {
  now = 0;
  mock.method(Date, 'now', () => now);
});

afterEach(() => {
  mock.restoreAll();
});

test('createRateLimiter allows the configured number of requests and reports retry time', () => {
  const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 2 });

  assert.deepEqual(limiter.check('198.51.100.1'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.1'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.1'), { allowed: false, retryAfter: 10 });

  now = 5_001;
  assert.deepEqual(limiter.check('198.51.100.1'), { allowed: false, retryAfter: 5 });
});

test('an expired window starts fresh without affecting another address', () => {
  const limiter = createRateLimiter({ windowMs: 1_000, maxRequests: 1 });

  assert.deepEqual(limiter.check('198.51.100.2'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.2'), { allowed: false, retryAfter: 1 });
  now = 1_001;
  assert.deepEqual(limiter.check('198.51.100.2'), { allowed: true });
  assert.deepEqual(limiter.check('198.51.100.3'), { allowed: true });
});

test('address churn at capacity cannot reset tracked windows', () => {
  const limiter = createRateLimiter({ maxRequests: 1, maxStoreSize: 2, windowMs: 1_000, cleanupInterval: 1 });
  assert.equal(limiter.check('first').allowed, true);
  assert.equal(limiter.check('second').allowed, true);
  for (let index = 0; index < 20; index++) {
    assert.deepEqual(limiter.check(`new-${index}`), { allowed: true });
    assert.equal(limiter.check('first').allowed, false);
    assert.equal(limiter.check('second').allowed, false);
  }
  now = 1_001;
  assert.equal(limiter.check('new-address').allowed, true);
  assert.equal(limiter.check('new-address').allowed, false);
});

test('reset clears a live window', () => {
  const limiter = createRateLimiter({ maxRequests: 1 });

  assert.deepEqual(limiter.check('198.51.100.7'), { allowed: true });
  assert.equal(limiter.check('198.51.100.7').allowed, false);
  limiter.reset();
  assert.deepEqual(limiter.check('198.51.100.7'), { allowed: true });
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
  assert.equal(limiter.check(addressKey(addresses[0]!)).allowed, true);
  for (const address of addresses.slice(1)) {
    assert.equal(limiter.check(addressKey(address)).allowed, false);
  }
  for (let index = 3; index < 10_005; index++) {
    assert.equal(limiter.check(addressKey(`2001:db8:abcd:1234::${index.toString(16)}`)).allowed, false);
  }
  assert.equal(
    limiter.check(addressKey('2001:db8:abcd:1235::1')).allowed,
    true,
    'a separate network retains its bucket'
  );
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
