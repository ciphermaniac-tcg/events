import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyTournament } from '../../shared/tournament/create.ts';
import { printSheet, type SheetEvent } from '../../src/pages/tournaments/printSheet.ts';

const DECK = [
  'Pokémon: 3',
  '2 Dreepy TWM 128',
  '1 Drakloak TWM 129',
  'Trainer: 1',
  '1 Arven SVI 166',
  'Energy: 2',
  '2 Basic Psychic Energy SVE 5',
  'a line that is no card'
].join('\n');

const event: SheetEvent = {
  code: 'CUP123',
  settings: { format: 'Standard', startsAt: '', venue: '' },
  tournament: emptyTournament({ name: 'League Cup', city: 'Austin', state: 'TX', startDate: '11/15/2026' })
};

const list = {
  popId: '4418027',
  firstName: 'Ava',
  lastName: 'Martinez',
  birthDate: '02/27/2012',
  deck: DECK,
  submittedAt: 0
};

test('a sanctioned sheet carries the Player ID, birth year and division, and the list by section', () => {
  const sheet = printSheet(event, list, true, 'https://events.example');
  assert.deepEqual(sheet.event, {
    name: 'League Cup',
    date: 'November 15, 2026',
    place: 'Austin, TX',
    format: 'Standard',
    url: 'https://events.example/t/CUP123'
  });
  assert.deepEqual(sheet.player, { name: 'Ava Martinez', popId: '4418027', birthYear: 2012, division: 'senior' });
  assert.deepEqual(
    sheet.sections.map(s => [s.section, s.count, s.cards.length]),
    [
      ['pokemon', 3, 2],
      ['trainer', 1, 1],
      ['energy', 2, 1]
    ]
  );
  assert.equal(sheet.total, 6);
  assert.deepEqual(sheet.unread, ['a line that is no card']);
});

test('an unsanctioned sheet prints the name alone, and the venue wins over the city', () => {
  const sheet = printSheet(
    { ...event, settings: { ...event.settings, venue: 'D2G TCG' } },
    list,
    false,
    'https://events.example'
  );
  assert.deepEqual(sheet.player, { name: 'Ava Martinez', popId: '', birthYear: null, division: null });
  assert.equal(sheet.event.place, 'D2G TCG');
});

test('an event with no date prints none, and a section with no cards is left out', () => {
  const sheet = printSheet(
    { ...event, tournament: emptyTournament({ name: 'Casual night' }) },
    { ...list, deck: 'Trainer: 4\n4 Arven SVI 166' },
    false,
    'https://events.example'
  );
  assert.equal(sheet.event.date, '');
  assert.deepEqual(
    sheet.sections.map(s => s.section),
    ['trainer']
  );
});
