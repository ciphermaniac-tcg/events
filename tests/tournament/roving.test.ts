/**
 * Arrow keys, Home and End across a row of tabs or radios
 * (src/components/roving.ts): each arrow steps and wraps, Home and End go to
 * the ends, anything else moves nothing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rovingIndex } from '../../src/components/roving.ts';

test('the arrows step either way and wrap at the ends', () => {
  assert.equal(rovingIndex('ArrowRight', 0, 3), 1);
  assert.equal(rovingIndex('ArrowDown', 2, 3), 0);
  assert.equal(rovingIndex('ArrowLeft', 0, 3), 2);
  assert.equal(rovingIndex('ArrowUp', 1, 3), 0);
});

test('Home and End go to the ends; other keys, or an empty row, move nothing', () => {
  assert.equal(rovingIndex('Home', 2, 4), 0);
  assert.equal(rovingIndex('End', 0, 4), 3);
  assert.equal(rovingIndex('Enter', 1, 4), null);
  assert.equal(rovingIndex('Tab', 1, 4), null);
  assert.equal(rovingIndex('ArrowRight', 0, 0), null);
});
