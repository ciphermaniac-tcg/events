import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { readCommand } from '../../shared/tournament/readCommand.ts';
import { returnEffects } from '../../shared/tournament/returns.ts';
import { revisionOf } from '../../shared/tournament/revision.ts';
import { type ExtensionCommand, keepTimeExtensions, setTimeExtension } from '../../shared/tournament/timeExtensions.ts';
import { withSiteClocks } from '../../shared/tournament/tomClock.ts';
import type { Match, Round, Tournament } from '../../shared/tournament/types.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { assignKeys, publicTournament } from '../../shared/tournament/view.ts';
import { commandRunner } from '../__utils__/commands.ts';

const ctx = { now: 1_000, localTime: '10/10/2026 12:00:00', season: 2027, random: seededRandom(1) };
const run = commandRunner(ctx);
function event(): Tournament {
  let t = emptyTournament({ name: 'Extensions' });
  for (let i = 0; i < 4; i += 1) {
    t = run(t, { type: 'addPlayer', player: { firstName: 'Player', lastName: String(i), id: String(100 + i) } });
  }
  return run(t, { type: 'pairRound', pod: 'masters' });
}
const firstMatch = (t: Tournament) => t.pods[0]!.rounds[0]!.matches[0]!;
function command(t: Tournament, patch: Partial<ExtensionCommand> = {}): ExtensionCommand {
  const { table, p1, p2 } = firstMatch(t);
  return {
    type: 'setTimeExtension',
    pod: 'masters',
    round: 1,
    table,
    p1,
    p2: p2!,
    seconds: 300,
    reason: ' Judge call ',
    ...patch
  };
}

test('extensions change only the selected table, replace the total, and can be removed', () => {
  const t = event();
  const changed = run(t, command(t));
  assert.deepEqual(firstMatch(changed).timeExtension, { seconds: 300, reason: 'Judge call' });
  assert.equal(firstMatch(t).timeExtension, undefined);
  assert.equal(changed.pods[0]?.rounds[0]?.timeLeft, t.pods[0]?.rounds[0]?.timeLeft);
  assert.equal(changed.pods[0]?.rounds[0]?.matches[1], t.pods[0]?.rounds[0]?.matches[1]);
  const edited = run(changed, command(t, { seconds: 600, reason: '' }));
  assert.equal(firstMatch(edited).timeExtension?.seconds, 600);
  assert.equal(firstMatch(run(edited, command(t, { seconds: 0 }))).timeExtension, undefined);
});

test('rejects stale rounds, tables, pods and player identities', () => {
  const t = event();
  for (const patch of [{ round: 2 }, { table: 999 }, { p1: '999' }, { p2: '999' }, { pod: 'junior' as const }]) {
    assert.equal(typeof setTimeExtension(t, command(t, patch)), 'string');
  }
  const old = structuredClone(t);
  old.pods[0]!.rounds.push({ ...old.pods[0]!.rounds[0]!, number: 2 });
  assert.equal(typeof setTimeExtension(old, command(t)), 'string');
});

test('rejects completed matches and byes', () => {
  const t = event();
  const match = firstMatch(t);
  const finished = run(t, { ...command(t), type: 'reportResult', outcome: 'p1' });
  assert.equal(typeof setTimeExtension(finished, command(t)), 'string');
  const bye = structuredClone(t);
  firstMatch(bye).p2 = null;
  const malformed = { ...command(t), p2: null } as unknown as ExtensionCommand;
  assert.equal(typeof setTimeExtension(bye, malformed), 'string');
  assert.equal(match.outcome, 'pending');
});

test('enforces integer, duration, and reason limits in both command paths', () => {
  const t = event();
  for (const seconds of [-1, 0.5, 3601, NaN, Infinity]) {
    assert.equal(readCommand(command(t, { seconds })), null);
    assert.equal(typeof setTimeExtension(t, command(t, { seconds })), 'string');
  }
  assert.equal(readCommand(command(t, { reason: 'x'.repeat(201) })), null);
  assert.equal(typeof setTimeExtension(t, command(t, { reason: 'x'.repeat(201) })), 'string');
  assert.ok(readCommand(command(t, { seconds: 0 })));
  assert.ok(readCommand(command(t, { seconds: 3600, reason: 'x'.repeat(200) })));
  for (const field of ['pod', 'round', 'table', 'p1', 'p2', 'seconds', 'reason']) {
    assert.equal(readCommand({ ...command(t), [field]: null }), null);
  }
});

test('TOM sync retains extensions only on the same pairing and ignores uploaded metadata', async () => {
  const t = event();
  const held = run(t, command(t));
  const file = structuredClone(t);
  firstMatch(file).timeExtension = { seconds: 900, reason: 'Uploaded' };
  assert.equal(await revisionOf(held), await revisionOf(t));
  assert.deepEqual(firstMatch(withSiteClocks(file, held)).timeExtension, firstMatch(held).timeExtension);
  assert.equal(firstMatch(withSiteClocks(file, null)).timeExtension, undefined);
  firstMatch(file).p2 = 'another-player';
  assert.equal(firstMatch(withSiteClocks(file, held)).timeExtension, undefined);
  assert.equal(keepTimeExtensions(file.pods[0]!.rounds[0]!)[0]?.timeExtension, undefined);
});

test('public views expose extra time without staff notes and validators enforce persisted bounds', () => {
  const original = event();
  const t = run(original, command(original));
  const publicCopy = publicTournament(t, assignKeys(t, {}));
  assert.deepEqual(firstMatch(publicCopy).timeExtension, { seconds: 300, reason: '' });
  assert.ok(!JSON.stringify(publicCopy).includes('Judge call'));
  assert.deepEqual(firstMatch(readTournament(t)!).timeExtension, firstMatch(t).timeExtension);
  for (const extension of [
    { seconds: 0, reason: '' },
    { seconds: 3601, reason: '' },
    { seconds: 5, reason: 'x'.repeat(201) }
  ]) {
    const bad = structuredClone(t);
    firstMatch(bad).timeExtension = extension;
    assert.equal(readTournament(bad), null);
  }
});

test('recording a result keeps the extension as part of the match history', () => {
  const t = event();
  const extended = run(t, command(t));
  const result = run(extended, { ...command(t), type: 'reportResult', outcome: 'p1' });
  assert.deepEqual(firstMatch(result).timeExtension, firstMatch(extended).timeExtension);
});

test('swapping players clears extensions on changed pairings', () => {
  const t = event();
  const extended = run(t, command(t));
  const a = firstMatch(t).p1;
  const b = t.pods[0]!.rounds[0]!.matches[1]!.p1;
  const swapped = run(extended, { type: 'swapPlayers', pod: 'masters', a, b });
  assert.equal(firstMatch(swapped).timeExtension, undefined);
  assert.equal(typeof setTimeExtension(swapped, command(t)), 'string');
});

test('table time follows the round clock through pause and resume', () => {
  const initial = event();
  const running = run(initial, { type: 'startClock', pod: 'masters' });
  const extended = run(running, command(initial));
  const original = initial.pods[0]!.rounds[0]!.timeLeft;
  const paused = applyCommand(extended, { type: 'stopClock', pod: 'masters' }, { ...ctx, now: 11_000 });
  assert.ok(paused.ok);
  assert.equal(paused.tournament.pods[0]!.rounds[0]!.timeLeft, original - 10);
  assert.equal(paused.tournament.pods[0]!.rounds[0]!.clockStartedAt, null);
  const resumed = applyCommand(paused.tournament, { type: 'startClock', pod: 'masters' }, { ...ctx, now: 31_000 });
  assert.ok(resumed.ok);
  const round = resumed.tournament.pods[0]!.rounds[0]!;
  assert.equal(round.timeLeft, original - 10);
  assert.equal(firstMatch(resumed.tournament).timeExtension?.seconds, 300);
  assert.equal(round.clockStartedAt, 31_000);
});

test('read-only reinstatement eligibility preserves legacy and staged-round behavior', () => {
  const t = event();
  const { id } = t.players[0]!;
  const dropping = (tournament: Tournament, droppedAfter: number | null): Tournament => ({
    ...tournament,
    players: tournament.players.map(p => (p.id === id ? { ...p, droppedAfter } : p))
  });
  const offered = (tournament: Tournament) => returnEffects(tournament, id).offered;
  const { settings: _settings, ...legacy } = t;
  assert.equal(offered(dropping(legacy, 1)), true);
  assert.equal(offered(dropping(legacy, 0)), false);
  assert.equal(offered(dropping(t, null)), false);
  const next = structuredClone(dropping(t, 1));
  const first = next.pods[0]!.rounds[0]!;
  const round: Round = { ...first, number: 3, stage: 3, matches: [] };
  next.pods[0]!.rounds.push({ ...first, number: 2, matches: [] }, round);
  assert.equal(offered(next), true);
  round.stage = 4;
  assert.equal(offered(next), false);
});
