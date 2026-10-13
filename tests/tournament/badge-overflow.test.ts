import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Badge } from '../../shared/accounts/achievements.ts';
import { visibleBadgeCount } from '../../src/lib/tournament/badgeOverflow.ts';

const badges: Badge[] = [
  { key: 'creator' },
  { key: 'beta' },
  { key: 'played', count: 25, tier: 3 },
  { key: 'won', count: 5, tier: 2 },
  { key: 'organized', count: 10, tier: 2 },
  { key: 'staffed', count: 10, tier: 2 },
  { key: 'traveler', count: 5, tier: 2 },
  { key: 'bug', count: 1, tier: 1 }
];
const sizes = { badge: 28, gap: 2, divider: 9, more: 32 };

test('all badges remain visible when the row fits exactly, with no fixed cap', () => {
  assert.equal(visibleBadgeCount(badges, 249, sizes), 8);
  assert.equal(visibleBadgeCount(badges, 500, sizes), 8);
  assert.equal(visibleBadgeCount([], 0, sizes), 0);
});

test('overflow reserves the button and divider before the badges wrap', () => {
  assert.equal(visibleBadgeCount(badges, 248, sizes), 6);
  assert.equal(visibleBadgeCount(badges, 100, sizes), 2);
  assert.equal(visibleBadgeCount(badges, 32, sizes), 0);
  assert.equal(visibleBadgeCount(badges.slice(2), 180, sizes), 6);
});
