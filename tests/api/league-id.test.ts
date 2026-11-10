import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as leagues from '../../functions/api/leagues/[id].ts';
import { apiSuite, type Handler } from '../__utils__/apiCalls.ts';

const { hit, signIn } = apiSuite();

test('a malformed encoded league ID is a bad request, not a failure', async () => {
  const helper = await signIn('Helper');
  const answer = await hit(
    leagues.onRequestGet as Handler,
    '/api/leagues/%E0%A4%A',
    { id: '%E0%A4%A' },
    { cookie: helper }
  );
  assert.deepEqual([answer.status, answer.json.error], [400, 'Not a league ID']);
});
