import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { newCode } from '../../functions/lib/tournaments/store.ts';
import { isCode } from '../../shared/tournament/eventCode.ts';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

test('event codes are six characters from the 31-character alphabet', () => {
  assert.equal(ALPHABET.length, 31);
  const seen = new Set<string>();
  for (let index = 0; index < 2000; index++) {
    const code = newCode();
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    assert.ok(isCode(code));
    for (const char of code) {
      seen.add(char);
    }
  }
  assert.equal(seen.size, ALPHABET.length, 'every character turns up');
});

test('codes come from the cryptographic generator, not Math.random', () => {
  const predictable = mock.method(Math, 'random', () => 0);
  try {
    const codes = new Set(Array.from({ length: 20 }, () => newCode()));
    assert.ok(codes.size > 1, 'codes vary while Math.random does not');
    assert.equal(predictable.mock.callCount(), 0);
  } finally {
    predictable.mock.restore();
  }
});

test('a given source of randomness still picks the code', () => {
  assert.equal(
    newCode(6, () => 0),
    'AAAAAA'
  );
  assert.equal(
    newCode(6, () => 0.999_999),
    '999999'
  );
  const steps = [0, 1 / 31, 2 / 31, 30 / 31];
  let next = 0;
  assert.equal(
    newCode(4, () => steps[next++]!),
    'ABC9'
  );
});
