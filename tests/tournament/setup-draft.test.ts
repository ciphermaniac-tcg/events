import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { clearSetupDraft, setupDraft, setupDraftKey, tdfDraftId } from '../../src/lib/tournament/setupDraft.ts';

let values: Map<string, string>;
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
  });
});
afterEach(() => {
  if (original) {
    Object.defineProperty(globalThis, 'localStorage', original);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('draft keys separate accounts, event modes and imported files without delimiter collisions', () => {
  assert.notEqual(setupDraftKey('a:b', 'swiss'), setupDraftKey('a', 'b:swiss'));
  assert.notEqual(setupDraftKey('a', 'swiss'), setupDraftKey('b', 'swiss'));
  assert.notEqual(setupDraftKey('a', 'swiss'), setupDraftKey('a', 'tom'));
  assert.notEqual(setupDraftKey('a', 'tom', 'First'), setupDraftKey('a', 'tom', 'Second'));
});

test('field changes recover together, preserving empty minutes and false choices', () => {
  const key = setupDraftKey('a', 'swiss');
  const field = setupDraft(key);
  const [name, setName] = field('name', '', isString);
  const [, setMinutes] = field('roundTime', '30', isString);
  const [, setReporting] = field('reporting', true, isBoolean);
  setName('Friday');
  setMinutes('');
  setReporting(false);
  assert.equal(name(), 'Friday');
  const recovered = setupDraft(key);
  assert.equal(recovered('name', '', isString)[0](), 'Friday');
  assert.equal(recovered('roundTime', '30', isString)[0](), '');
  assert.equal(recovered('reporting', true, isBoolean)[0](), false);
  assert.equal(setupDraft(setupDraftKey('b', 'swiss'))('name', '', isString)[0](), '');
});

test('clearing a successful setup removes only its draft', () => {
  const own = setupDraftKey('a', 'swiss');
  const other = setupDraftKey('b', 'swiss');
  values.set(own, '{"name":"Friday"}');
  values.set(other, '{"name":"Saturday"}');
  clearSetupDraft(own);
  assert.equal(setupDraft(own)('name', '', isString)[0](), '');
  assert.equal(setupDraft(other)('name', '', isString)[0](), 'Saturday');
});

test('malformed drafts and fields recover defaults and can be replaced', () => {
  for (const text of ['{broken', '[]', 'null', 'false', '{"name":42}']) {
    values.set('draft', text);
    const [name, setName] = setupDraft('draft')('name', 'Default', isString);
    assert.equal(name(), 'Default');
    setName('Repaired');
    assert.equal(setupDraft('draft')('name', '', isString)[0](), 'Repaired');
  }
});

test('unavailable storage leaves a usable form and does not block successful-create clearing', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('Storage unavailable');
    }
  });
  const [name, setName] = setupDraft('draft')('name', '', isString);
  setName('Still usable');
  assert.equal(name(), 'Still usable');
  assert.doesNotThrow(() => clearSetupDraft('draft'));
});

test('TOM drafts follow the event, not its name: same-named files keep their own answers', () => {
  // `saved` stands for whatever else TOM writes into the file as the event goes on.
  const named = (sanctionId: string, saved: number) => {
    const tournament = emptyTournament({ name: 'Friday League' });
    tournament.info.sanctionId = sanctionId;
    tournament.info.city = `Saved ${saved}`;
    return tournament;
  };
  const first = setupDraftKey('a', 'tom', tdfDraftId(named('26-09-000001', 0)));
  const second = setupDraftKey('a', 'tom', tdfDraftId(named('26-09-000002', 0)));
  assert.notEqual(first, second, 'two sanctioned events with one name');
  setupDraft(first)('playToolsConfirmed', false, isBoolean)[1](true);
  assert.equal(setupDraft(second)('playToolsConfirmed', false, isBoolean)[0](), false, 'nothing carries across');
  assert.equal(
    tdfDraftId(named('26-09-000001', 0)),
    tdfDraftId(named('26-09-000001', 3)),
    'the same sanctioned event as TOM saves it again'
  );
  assert.notEqual(tdfDraftId(named('', 0)), tdfDraftId(named('', 1)), 'two unsanctioned files with one name');
  assert.equal(tdfDraftId(named('', 2)), tdfDraftId(named('', 2)), 'the same file reads the same');
});
