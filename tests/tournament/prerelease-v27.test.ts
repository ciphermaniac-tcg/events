import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand } from '../../shared/tournament/commands.ts';
import { applyLifecycleOperation } from '../../shared/tournament/lifecycle.ts';
import { prereleaseChoiceAvailable } from '../../shared/tournament/lifecycleWorkflow.ts';
import { regularRounds } from '../../shared/tournament/rounds.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import { lifecycleDocument } from '../../shared/tournament/lifecycleImport.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { completed, context, generatedEvent, operated } from './conformance-generated.ts';

const ctx = context(11);

function nextRound(t: Tournament): Tournament {
  const result = applyCommand(t, { type: 'pairRound', pod: t.pods[0]!.category }, ctx);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.tournament;
}

function played(rounds: number, count = 9): Tournament {
  const base = generatedEvent(count, ctx, { additionalRounds: 0 });
  let t: Tournament = {
    ...base,
    info: { ...base.info, eventType: 'prerelease', finalsRoundTime: 30 },
    settings: { ...base.settings!, mode: 'PRERELEASE' }
  };
  for (let i = 0; i < rounds; i += 1) {
    t = completed(nextRound(t), ctx);
  }
  return t;
}

function conclude(t: Tournament) {
  return applyCommand(t, { type: 'concludePrerelease', pod: t.pods[0]!.category }, ctx);
}

test('V27: early conclusion requires round 3 and is distinct from ordinary standings acknowledgment', () => {
  assert.equal(conclude(played(2)).ok, false);
  const t = played(3);
  assert.equal(prereleaseChoiceAvailable(t, t.pods[0]!), true);
  assert.equal(conclude(operated(t, { type: 'viewStandings' }, ctx)).ok, false);
  const ended = conclude(t);
  assert.ok(ended.ok);
  assert.equal(ended.tournament.settings!.stage, 4);
  assert.equal(regularRounds(ended.tournament, ended.tournament.pods[0]!), 3);
  assert.equal(ended.tournament.pods[0]!.additionalRounds, 0);
  assert.equal(readTournament(ended.tournament)?.pods[0]!.prereleaseConcluded, true);
  assert.equal(applyCommand(ended.tournament, { type: 'pairRound', pod: 'masters' }, ctx).ok, false);
  assert.equal(applyLifecycleOperation(ended.tournament, { type: 'finish' }, ctx).ok, true);
});

test('V27: a reopening loses early conclusion and restores the ordinary count', () => {
  const ended = conclude(played(3));
  assert.ok(ended.ok);
  const xml = writeTdf(ended.tournament);
  assert.match(xml, /<round number="3" type="2" stage="8" >/);
  assert.ok(!xml.includes('prereleaseConcluded'));
  const imported = lifecycleDocument(parseTdf(xml));
  assert.equal(imported.pods[0]!.prereleaseConcluded, undefined);
  assert.equal(regularRounds(imported, imported.pods[0]!), 6);
  const reopened = operated(ended.tournament, { type: 'reload' }, ctx);
  assert.equal(reopened.pods[0]!.rounds.at(-1)!.stage, 5);
  assert.equal(applyLifecycleOperation(reopened, { type: 'finish' }, ctx).ok, false);
});

test('V27: a failed next pairing automatically concludes a Prerelease below round 3', () => {
  const t = played(1, 2);
  const ended = nextRound(t);
  assert.equal(ended.pods[0]!.rounds.length, 1);
  assert.equal(ended.pods[0]!.rounds[0]!.stage, 8);
  assert.equal(regularRounds(ended, ended.pods[0]!), 1);
  assert.equal(applyLifecycleOperation(ended, { type: 'finish' }, ctx).ok, true);
  const custom = {
    ...t,
    info: { ...t.info, eventType: 'local' as const },
    settings: { ...t.settings!, mode: 'CUSTOM' as const }
  };
  assert.equal(conclude(custom).ok, false);
  assert.equal(applyCommand(custom, { type: 'pairRound', pod: 'masters' }, ctx).ok, false);
});

test('V27: continuation marks stage 7 only from round 3 and does not change the maximum', () => {
  const t = nextRound(played(3));
  assert.deepEqual(
    t.pods[0]!.rounds.slice(0, 3).map(r => r.stage),
    [6, 6, 7]
  );
  assert.equal(regularRounds(t, t.pods[0]!), 6);
  assert.equal(t.pods[0]!.additionalRounds, 0);
});
