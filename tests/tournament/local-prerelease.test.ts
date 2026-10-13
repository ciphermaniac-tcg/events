import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { lifecycleDocument } from '../../shared/tournament/lifecycleImport.ts';
import { readCommand } from '../../shared/tournament/readCommand.ts';
import { regularRounds } from '../../shared/tournament/rounds.ts';
import { recommendedStructure } from '../../shared/tournament/structure.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import type { EventType, Tournament } from '../../shared/tournament/types.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { completed, context, operated } from './conformance-generated.ts';

const ctx = context(17);

function command(t: Tournament, change: Command): Tournament {
  const result = applyCommand(t, change, ctx);
  assert.ok(result.ok, `${change.type}: ${result.ok ? '' : result.error}`);
  return result.tournament;
}

function registered(eventType: EventType, count = 13): Tournament {
  let t = emptyTournament({ name: 'Synthetic', eventType });
  for (let i = 0; i < count; i += 1) {
    t = command(t, {
      type: 'addPlayer',
      player: { id: String(i + 1), firstName: 'Synthetic', lastName: String(i + 1), birthDate: '01/01/1990' }
    });
  }
  return t;
}

for (const [eventType, mode, rounds] of [
  ['local', 'CUSTOM', 4],
  ['prerelease', 'PRERELEASE', 6]
] as const) {
  test(`${eventType}: registration, pairing, persistence and imports retain mode and type 2 schedule`, () => {
    const t = command(registered(eventType), { type: 'pairRound', pod: 'masters' });
    assert.equal(t.settings!.mode, mode);
    assert.equal(t.settings!.type, 2);
    assert.equal(regularRounds(t, t.pods[0]!), rounds);
    assert.deepEqual(recommendedStructure(13, eventType), { rounds, cut: 0 });
    assert.equal(readTournament(t)?.info.eventType, eventType);
    const xml = writeTdf(t);
    assert.match(
      xml,
      new RegExp(`<tournament type="2" stage="4" version="1.86" gametype="TRADING_CARD_GAME" mode="${mode}"`)
    );
    assert.match(xml, /<round number="1" type="2" stage="2" >\n/);
    const imported = lifecycleDocument(parseTdf(xml));
    assert.equal(imported.info.eventType, eventType);
    assert.equal(imported.settings!.mode, mode);
    assert.equal(regularRounds(imported, imported.pods[0]!), rounds);
    assert.equal(writeTdf(parseTdf(xml)), xml);
  });

  test(`${eventType}: an explicitly chosen cut uses type 3 rounds and retains its mode`, () => {
    let t = command(registered(eventType, 12), { type: 'pairRound', pod: 'masters' });
    const planned = regularRounds(t, t.pods[0]!);
    for (let i = 1; i <= planned; i += 1) {
      t = completed(t, ctx);
      if (i < planned) {
        t = command(t, { type: 'pairRound', pod: 'masters' });
      }
    }
    const cut = command(t, { type: 'startTopCut', pod: 'masters', size: 4, playoff3rd4th: true });
    assert.equal(cut.settings!.type, 3);
    assert.equal(cut.settings!.mode, mode);
    assert.equal(regularRounds(cut, cut.pods[0]!), 4);
    assert.equal(cut.pods[0]!.playoff3rd4th, true);
    assert.equal(cut.pods[0]!.rounds.at(-1)!.kind, 'elimination');
    assert.match(writeTdf(cut), new RegExp(`<round number="${planned + 1}" type="1" stage="2" >`));
  });
}

test('event kind changes update both TOM mode and structure, including imported Custom events', () => {
  let t = lifecycleDocument(registered('local'));
  for (const [eventType, mode, type] of [
    ['prerelease', 'PRERELEASE', 2],
    ['cup', 'TCG1DAY', 3],
    ['challenge', 'LEAGUECHALLENGE', 2],
    ['local', 'CUSTOM', 2]
  ] as const) {
    const change = { type: 'updateInfo', info: { eventType } } as const;
    assert.deepEqual(readCommand(change), change);
    t = command(t, change);
    assert.equal(t.settings!.mode, mode);
    assert.equal(t.settings!.type, type);
  }
});

test('Prerelease another round saves stage 7 from round 3; early conclusion saves 8', () => {
  let t = command(registered('prerelease'), { type: 'pairRound', pod: 'masters' });
  for (let i = 1; i <= 3; i += 1) {
    t = completed(t, ctx);
    if (i < 3) {
      t = command(t, { type: 'pairRound', pod: 'masters' });
    }
  }
  const next = command(t, { type: 'pairRound', pod: 'masters' });
  assert.equal(next.pods[0]!.rounds[2]!.stage, 7);
  assert.match(writeTdf(next), /<round number="3" type="2" stage="7" >/);
  const ended = operated(command(t, { type: 'concludePrerelease', pod: 'masters' }), { type: 'finish' }, ctx);
  assert.equal(ended.pods[0]!.rounds[2]!.stage, 8);
  assert.equal(ended.settings!.stage, 5);
  assert.match(writeTdf(ended, { finalized: true }), /<round number="3" type="2" stage="8" >/);
});

test('event detail edits hold Local and Prerelease round times to their V27 ranges', () => {
  for (const [eventType, minimum] of [
    ['local', 10],
    ['prerelease', 20]
  ] as const) {
    const t = registered(eventType, 4);
    const edit = (roundTime: number) => applyCommand(t, { type: 'updateInfo', info: { roundTime } }, ctx);
    assert.ok(edit(minimum).ok);
    assert.ok(edit(90).ok);
    for (const outside of [minimum - 1, 91]) {
      const result = edit(outside);
      assert.equal(result.ok, false);
      assert.equal(result.ok ? '' : result.error, `Round times are whole minutes, from ${minimum} to 90`);
    }
  }
  assert.ok(applyCommand(registered('cup', 4), { type: 'updateInfo', info: { roundTime: 180 } }, ctx).ok);
});

test('a new Local event suggests 30-minute Swiss rounds', () => {
  const { info } = emptyTournament({ name: 'Synthetic', eventType: 'local' });
  assert.equal(info.roundTime, 30);
  assert.equal(info.finalsRoundTime, 75);
});
