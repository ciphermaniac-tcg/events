import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initEventMemory, migrateEventMemory } from '../../src/lib/tournament/sessionMemory.ts';

function storage(entries: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: key => {
      values.delete(key);
    },
    clear: () => values.clear()
  };
}

test('legacy PII moves to the session while recovery credentials remain persistent', () => {
  const profile = { popId: '123', firstName: 'Pat', lastName: 'Lee', birthDate: '2000' };
  const persistent = storage({
    'cm-decklist:first': JSON.stringify({ profile, token: 'deck token' }),
    'cm-tournament-player:second': 'POP ID and birth year',
    'cm-tournament-me:second': 'player key',
    'cm-tournament-report:third': 'report token',
    'cm-device': 'device ID',
    'cm:mode': 'dark'
  });
  const session = storage();
  migrateEventMemory(persistent, session);
  assert.equal(session.getItem('cm-decklist:first'), JSON.stringify(profile));
  assert.equal(persistent.getItem('cm-decklist:first'), JSON.stringify({ token: 'deck token' }));
  for (const key of ['cm-tournament-player:second', 'cm-tournament-me:second']) {
    assert.notEqual(session.getItem(key), null);
    assert.equal(persistent.getItem(key), null);
  }
  assert.equal(persistent.getItem('cm-device'), 'device ID');
  assert.equal(persistent.getItem('cm-tournament-report:third'), 'report token');
  assert.equal(persistent.getItem('cm:mode'), 'dark');
  migrateEventMemory(persistent, session);
  assert.equal(session.length, 3, 'migration is idempotent');
  const newTab = storage();
  migrateEventMemory(persistent, newTab);
  assert.equal(newTab.getItem('cm-decklist:first'), null, 'PII is not restored in a new tab');
  assert.equal(persistent.getItem('cm-decklist:first'), JSON.stringify({ token: 'deck token' }));
});

test('migration preserves newer session details over stale persistent details', () => {
  const persistent = storage({ 'cm-tournament-player:first': 'old identity' });
  const session = storage({ 'cm-tournament-player:first': 'current identity' });
  migrateEventMemory(persistent, session);
  assert.equal(session.getItem('cm-tournament-player:first'), 'current identity');
  assert.equal(persistent.length, 0);
});

test('migration tolerates unusable storage and malformed legacy deck credentials', () => {
  const persistent = storage({
    'cm-decklist:first': JSON.stringify({ profile: {}, token: 'deck token' }),
    'cm-decklist:invalid': 'null'
  });
  const session = storage();
  session.setItem = () => {
    throw new Error('Storage unavailable');
  };
  migrateEventMemory(persistent, session);
  assert.equal(persistent.getItem('cm-decklist:first'), JSON.stringify({ token: 'deck token' }));
  assert.equal(persistent.getItem('cm-decklist:invalid'), null);
  assert.doesNotThrow(() => initEventMemory(), 'initialization tolerates an environment without browser storage');
});
