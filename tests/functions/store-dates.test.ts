import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dateIn } from '../../shared/accounts/stores.ts';
import { pastEventDate } from '../../functions/lib/stores/dates.ts';

test('a past event is dated in its store’s zone, the same day dateIn gives', () => {
  // 03:30 UTC on January 1 is still December 31 in Chicago.
  const at = Date.UTC(2026, 0, 1, 3, 30);
  for (const zone of ['America/Chicago', 'Asia/Tokyo', 'America/Chicago']) {
    assert.equal(pastEventDate(zone, at), dateIn(zone, at));
  }
  assert.equal(pastEventDate('America/Chicago', at), '2025-12-31');
});
