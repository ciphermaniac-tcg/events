/**
 * Finding a player in a long list by table number or Player ID, and the
 * "Last, First" name a list sorted by last name shows.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { byLastName, byNumber, findPlayers, sortName } from '../../src/pages/tournaments/playerSearch.ts';
import { commandRunner, freshContext } from '../__utils__/commands.ts';

const run = commandRunner(freshContext(3, '10/10/2026 10:00:00'));
const adds: Command[] = [
  ['Cy', 'Abe'],
  ['Ada', 'Zed'],
  ['Ben', 'Abe'],
  ['Di', 'Moe']
].map(([firstName = '', lastName = ''], i) => ({
  type: 'addPlayer',
  player: { firstName, lastName, id: `900${i + 1}` }
}));
const paired = run(emptyTournament({ name: 'Night' }), ...adds, { type: 'pairRound', pod: 'masters' });
const players = [...paired.players].sort(byLastName);

test('a list sorted by last name shows "Last, First"', () => {
  assert.deepEqual(players.map(sortName), ['Abe, Ben', 'Abe, Cy', 'Moe, Di', 'Zed, Ada']);
});

test('a number finds the players at that table, then Player IDs that start with it', () => {
  const table = paired.pods[0]!.rounds[0]!.matches[0]!;
  const found = byNumber(paired, players, ` ${table.table} `) ?? [];
  assert.deepEqual(found.map(player => player.id).sort(), [table.p1, table.p2].sort());
  assert.deepEqual(byNumber(paired, players, '9003')?.map(sortName), ['Abe, Ben']);
  assert.equal(byNumber(paired, players, '900')?.length, 4);
  assert.equal(byNumber(paired, players, 'ada'), undefined, 'a name is left to the name search');
});

test('a name is found typed first name first, last name first, or in part', () => {
  const found = (query: string) => findPlayers(paired, players, query).map(sortName);
  assert.deepEqual(found('Ada Zed'), ['Zed, Ada']);
  assert.deepEqual(found('zed, ada'), ['Zed, Ada']);
  assert.deepEqual(found(' abe '), ['Abe, Ben', 'Abe, Cy']);
  assert.deepEqual(found('Di Mo'), ['Moe, Di'], 'a part of each name');
  assert.deepEqual(found('Ada Moe'), [], 'every word has to match');
  assert.deepEqual(findPlayers(paired, players, '9003').map(sortName), ['Abe, Ben'], 'a number still finds by ID');
});
