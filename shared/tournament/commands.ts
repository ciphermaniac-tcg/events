/** Organizer commands share the lifecycle used by TOM conformance replay. */
import type { Command, CommandContext, CommandResult } from './commandTypes.js';
import { applyCommand as applyLegacyCommand, generatedId, podded } from './legacyCommands.js';
import { lifecycleDocument } from './lifecycleImport.js';
import { concludePrerelease, finalPodRound, prereleaseChoiceAvailable } from './lifecycleWorkflow.js';
import { applyLifecycleOperation } from './lifecycle.js';
import type { LifecycleOperation } from './lifecycleTypes.js';
import { birthYear, divisionFor, divisionLookup } from './divisions.js';
import { defaultRootAttrs, eventTypeOf, SANCTIONED } from './structure.js';
import { countsComplete, hasStarted, latestRound } from './rounds.js';
import { DIVISIONS, type Tournament } from './types.js';
import { msg, msgf } from '../i18n.js';

export type { Command, CommandContext, CommandResult, EditableInfo, NewPlayer } from './commandTypes.js';

function translated(t: Tournament, command: Command, ctx: CommandContext): LifecycleOperation | undefined {
  const translations: Partial<Record<Command['type'], () => LifecycleOperation>> = {
    pairRound: () =>
      t.settings!.stage < 4
        ? { type: 'start' }
        : { type: 'pair', pod: (command as Extract<Command, { type: 'pairRound' }>).pod },
    repairRound: () => ({
      type: 'pair',
      pod: (command as Extract<Command, { type: 'repairRound' }>).pod,
      repair: true
    }),
    startClock: () => ({ type: 'startRound', pod: (command as Extract<Command, { type: 'startClock' }>).pod }),
    dropPlayer: () => ({
      type: 'drop',
      id: (command as Extract<Command, { type: 'dropPlayer' }>).id,
      disqualified: false,
      timestamp: ctx.localTime
    }),
    disqualifyPlayer: () => ({
      type: 'drop',
      id: (command as Extract<Command, { type: 'disqualifyPlayer' }>).id,
      disqualified: true,
      timestamp: ctx.localTime
    }),
    undropPlayer: () => ({ type: 'reenter', id: (command as Extract<Command, { type: 'undropPlayer' }>).id }),
    addPlayer: () => {
      const { player } = command as Extract<Command, { type: 'addPlayer' }>;
      return t.settings!.stage >= 4
        ? {
            type: 'late',
            player: { ...player, id: player.id?.trim() || generatedId(t, ctx.random) },
            markLate: true,
            forcedLoss: false,
            timestamp: ctx.localTime
          }
        : { type: 'register', players: [player] };
    },
    concludePrerelease: () => ({
      type: 'concludePrerelease',
      pod: (command as Extract<Command, { type: 'concludePrerelease' }>).pod
    }),
    startTopCut: () => ({ type: 'topCut', pod: (command as Extract<Command, { type: 'startTopCut' }>).pod }),
    reportResult: () => reported(t, command as Extract<Command, { type: 'reportResult' }>, ctx)
  };
  return translations[command.type]?.();
}

function reported(
  t: Tournament,
  command: Extract<Command, { type: 'reportResult' }>,
  ctx: CommandContext
): LifecycleOperation {
  const round = latestRound(t.pods.find(p => p.category === command.pod)!);
  const match = round?.matches.find(m => m.p1 === command.p1 && m.p2 === command.p2 && m.table === command.table);
  if (!round || round.number !== command.round || !match) {
    throw new Error(msg('The reported match has changed'));
  }
  if (command.outcome === 'pending') {
    return { type: 'reopen', pod: command.pod, round: command.round, player: command.p1 };
  }
  return {
    type: 'results',
    pod: command.pod,
    results: [{ ...match, outcome: command.outcome, timestamp: ctx.localTime }]
  };
}

function checkedCutDivisions(
  t: Tournament,
  pod: Tournament['pods'][number],
  command: Extract<Command, { type: 'startTopCut' }>
): void {
  const of = divisionLookup(t);
  const present = DIVISIONS.filter(d => pod.playerIds.some(id => of(id) === d));
  if (!command.division && present.length > 1) {
    throw new Error(msg('Pick the division to cut'));
  }
  if (command.division && pod.divisionCuts?.[command.division]?.playerIds) {
    throw new Error(msg('The top cut has started'));
  }
  if (!command.division && pod.stage === 1) {
    throw new Error(msg('The top cut has started'));
  }
}

function optionalPrereleaseRound(t: Tournament, command: Command, ctx: CommandContext): Tournament {
  if (!['pairRound', 'concludePrerelease'].includes(command.type) || t.settings?.mode !== 'PRERELEASE') {
    return t;
  }
  const category = (command as Extract<Command, { type: 'pairRound' }>).pod;
  const pod = t.pods.find(p => p.category === category);
  const round = latestRound(pod);
  if (!round || !countsComplete(round) || round.stage === 8) {
    return t;
  }
  const viewed = applyLifecycleOperation(t, { type: 'viewRecords', pod: category }, ctx).tournament;
  return command.type === 'pairRound' && pod && prereleaseChoiceAvailable(viewed, pod)
    ? applyLifecycleOperation(viewed, { type: 'playAnotherRound', pod: category }, ctx).tournament
    : viewed;
}

function automaticPrereleaseConclusion(
  result: ReturnType<typeof applyLifecycleOperation>,
  t: Tournament,
  command: Command,
  ctx: CommandContext
): ReturnType<typeof applyLifecycleOperation> {
  if (result.ok || command.type !== 'pairRound' || t.settings?.mode !== 'PRERELEASE') {
    return result;
  }
  const pod = t.pods.find(p => p.category === command.pod);
  const round = latestRound(pod);
  if (!pod || !round || !countsComplete(round) || round.stage === 8 || finalPodRound(t, pod, round)) {
    return result;
  }
  return {
    ok: true,
    tournament: concludePrerelease(
      result.tournament,
      { type: 'concludePrerelease', pod: command.pod, afterPairingFailure: true },
      ctx
    )
  };
}

function preparedCut(
  t: Tournament,
  command: Extract<Command, { type: 'startTopCut' }>,
  ctx: CommandContext
): Tournament {
  if (eventTypeOf(t) === 'challenge') {
    throw new Error(msg('A League Challenge has no top cut'));
  }
  const pod = t.pods.find(p => p.category === command.pod);
  if (!pod) {
    throw new Error(msg('There is no pod to cut'));
  }
  if (command.size < 4 && command.playoff3rd4th) {
    throw new Error(msg('A top cut of two cannot play for third'));
  }
  if (ctx.sanctioned && pod.rounds.filter(r => r.kind === 'swiss').length < SANCTIONED.swissRounds) {
    throw new Error(
      msgf('A sanctioned event plays at least {rounds} Swiss rounds before its top cut', {
        rounds: SANCTIONED.swissRounds
      })
    );
  }
  checkedCutDivisions(t, pod, command);
  const of = divisionLookup(t);
  const divisions = command.division
    ? [command.division]
    : DIVISIONS.filter(d => pod.playerIds.some(id => of(id) === d));
  const divisionCuts = {
    ...pod.divisionCuts,
    ...Object.fromEntries(
      divisions.map(d => [d, { size: command.size, playoff3rd4th: command.playoff3rd4th ?? false }])
    )
  };
  const changed = { ...pod, cut: command.size, divisionCuts, playoff3rd4th: command.playoff3rd4th ?? false };
  return { ...t, settings: { ...t.settings!, type: 3 }, pods: t.pods.map(p => (p === pod ? changed : p)) };
}

function checkedStart(t: Tournament, command: Command, ctx: CommandContext): void {
  if (
    command.type === 'pairRound' &&
    ctx.sanctioned &&
    t.settings!.stage < 4 &&
    t.players.filter(p => p.droppedAfter === null).length < SANCTIONED.players
  ) {
    throw new Error(msgf('A sanctioned event needs at least {players} players', { players: SANCTIONED.players }));
  }
}

/** A birth year a player can have: four digits, no later than the season the event is in. */
function readableBirthYear(birthDate: string | undefined, season: number): boolean {
  const year = birthYear(birthDate ?? '');
  return year !== null && year >= 1900 && year <= season;
}

/**
 * A sanctioned event admits a player only with their Player ID, which Play!
 * Pokémon reports results under, and their birth year, which places them in
 * their division; without it they would quietly play as Masters.
 */
function checkedAdmission(command: Command, ctx: CommandContext): void {
  if (command.type !== 'addPlayer' || !ctx.sanctioned) {
    return;
  }
  if (!command.player.id?.trim()) {
    throw new Error(msg('All players need Player IDs.'));
  }
  if (!readableBirthYear(command.player.birthDate, ctx.season)) {
    throw new Error(NEEDS_YEAR);
  }
}

const NEEDS_YEAR = msg('A sanctioned event needs each player’s birth year');

/**
 * A correction keeps the player where they play: a sanctioned event's player
 * keeps a birth year, and once round 1 is paired, a birth year that would move
 * them to another division is refused, since their pod, standings and top cut
 * are already that division's.
 */
function checkedCorrection(t: Tournament, command: Command, ctx: CommandContext): void {
  if (command.type !== 'editPlayer') {
    return;
  }
  if (ctx.sanctioned && !command.birthDate.trim()) {
    throw new Error(NEEDS_YEAR);
  }
  const player = t.players.find(p => p.id === command.id);
  // Only a year being changed is judged, so a name is still corrected beside an old year from a file.
  const newYear = birthYear(command.birthDate) !== birthYear(player?.birthDate ?? '');
  if (newYear && command.birthDate.trim() && !readableBirthYear(command.birthDate, ctx.season)) {
    throw new Error(msg('Birth year invalid'));
  }
  const moves = player && divisionFor(player.birthDate, ctx.season) !== divisionFor(command.birthDate, ctx.season);
  if (moves && hasStarted(t)) {
    throw new Error(msg('Play has started, so their birth year cannot change their division'));
  }
}

function additionalDivisionCut(t: Tournament, command: Command): boolean {
  if (command.type !== 'startTopCut' || !command.division) {
    return false;
  }
  const pod = t.pods.find(p => p.category === command.pod);
  return pod?.stage === 1 && !pod.divisionCuts?.[command.division]?.playerIds;
}

function legacyChange(t: Tournament, command: Command, ctx: CommandContext): CommandResult {
  const result = applyLegacyCommand(t, command, ctx);
  if (!result.ok || !result.tournament.settings) {
    return result;
  }
  const next = result.tournament;
  const settings = { ...next.settings! };
  if (command.type === 'setFixedTable' && command.table !== null) {
    settings.autoTables = false;
  }
  if (command.type === 'updateInfo' && command.info.eventType) {
    const attrs = new Map(defaultRootAttrs(command.info.eventType));
    settings.type = Number(attrs.get('type')) as 2 | 3;
    settings.mode = attrs.get('mode') as typeof settings.mode;
  }
  const pods = registrationPods(t, { ...next, settings }).map(pod => {
    const old = t.pods.find(p => p.category === pod.category);
    const stage = old?.stage === 1 && !pod.rounds.some(r => r.kind === 'elimination') ? (0 as const) : pod.stage;
    return {
      ...pod,
      stage,
      rounds: pod.rounds.map(round =>
        reconciledRound(
          round,
          old?.rounds.find(r => r.number === round.number)
        )
      )
    };
  });
  return { ok: true, tournament: { ...next, settings, pods } };
}

function registrationPods(t: Tournament, next: Tournament): Tournament['pods'] {
  if (t.settings!.stage >= 4 || next.settings!.type !== 1) {
    return next.pods;
  }
  const pod = t.pods.find(p => p.category === 'mixed') ?? next.pods[0];
  return pod ? [{ ...pod, category: 'mixed', playerIds: next.players.map(p => p.id) }] : [];
}

function reconciledRound(
  round: Tournament['pods'][number]['rounds'][number],
  prior: Tournament['pods'][number]['rounds'][number] | undefined
): typeof round {
  if (round.status === 'started' && prior?.status !== 'started') {
    return { ...round, stage: 4 };
  }
  return round;
}

function resumesClock(t: Tournament, command: Command): boolean {
  if (command.type !== 'startClock') {
    return false;
  }
  const round = latestRound(t.pods.find(p => p.category === command.pod));
  return round?.stage === 4 && round.clockStartedAt === null;
}

/** The site reports a round a retried pairing saved as paired, where TOM reports none (PAIRING V18-2). */
function commandResult(result: ReturnType<typeof applyLifecycleOperation>, prior: Tournament): CommandResult {
  return result.ok || result.retried
    ? { ok: true, tournament: result.tournament }
    : { ok: false, error: result.error!, ...(result.tournament === prior ? {} : { tournament: result.tournament }) };
}

function prepareRegistration(t: Tournament, command: Command, ctx: CommandContext): Tournament {
  if (command.type !== 'pairRound' || !t.settings || t.settings.stage >= 4) {
    return t;
  }
  const prepared = t.pods.length ? t : podded(t, ctx.season);
  if (t.settings.type !== 1 || !prepared.pods.length) {
    return prepared;
  }
  return {
    ...prepared,
    pods: [{ ...prepared.pods[0]!, category: 'mixed', playerIds: t.players.map(p => p.id), cut: 0 }]
  };
}

function registersBeforeStart(t: Tournament, command: Command): boolean {
  return command.type === 'addPlayer' && t.settings!.stage < 4;
}

/** Commands on an imported document that still take the legacy handlers, checked in this order. */
const LEGACY_ROUTES = [registersBeforeStart, additionalDivisionCut, resumesClock];

const refused = (error: unknown): CommandResult => ({
  ok: false,
  error: error instanceof Error ? error.message : msg('The command could not complete')
});

export function applyCommand(t: Tournament, command: Command, ctx: CommandContext): CommandResult {
  try {
    checkedAdmission(command, ctx);
    checkedCorrection(t, command, ctx);
  } catch (error) {
    return refused(error);
  }
  const imported = t.settings || t.passthrough || command.type === 'pairRound' ? lifecycleDocument(t) : t;
  const document = optionalPrereleaseRound(prepareRegistration(imported, command, ctx), command, ctx);
  if (!document.settings) {
    return applyLegacyCommand(t, command, ctx);
  }
  try {
    checkedStart(document, command, ctx);
    if (LEGACY_ROUTES.some(route => route(document, command))) {
      return legacyChange(document, command, ctx);
    }
    const prepared = command.type === 'startTopCut' ? preparedCut(document, command, ctx) : document;
    const operation = translated(prepared, command, ctx);
    if (!operation) {
      return legacyChange(document, command, ctx);
    }
    const result = applyLifecycleOperation(prepared, operation, ctx);
    return commandResult(automaticPrereleaseConclusion(result, prepared, command, ctx), prepared);
  } catch (error) {
    return refused(error);
  }
}
