import test from 'node:test';
import assert from 'node:assert/strict';

import { ordinal } from '../../src/lib/format.ts';

test('ordinal suffixes placements, giving every teen a th whatever its last digit', () => {
  const cases = [
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [111, '111th'],
    [113, '113th'],
    [21, '21st'],
    [22, '22nd'],
    [103, '103rd'],
    [1699, '1699th']
  ] as const;
  for (const [n, expected] of cases) {
    assert.equal(ordinal(n), expected);
  }
});
