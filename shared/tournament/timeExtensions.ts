import type { Match, PodCategory, Round, Tournament } from './types.js';

export const MAX_EXTENSION_SECONDS = 3600;
export const EXTENSION_REASON_MAX = 200;

export interface ExtensionCommand {
  type: 'setTimeExtension';
  pod: PodCategory;
  round: number;
  table: number;
  p1: string;
  p2: string;
  /** Total extra time for this match; zero removes the extension. */
  seconds: number;
  reason: string;
}

/** The pairing is stamped so an old editor cannot extend a newly paired table. */
export function setTimeExtension(tournament: Tournament, command: ExtensionCommand): Tournament | string {
  const error = extensionError(command);
  if (error) {
    return error;
  }
  const pod = tournament.pods.find(p => p.category === command.pod);
  const round = pod?.rounds.at(-1);
  const match = round?.matches.find(m => samePairing(m, command));
  if (!pod || !round || round.number !== command.round || !match) {
    return 'This match has changed; reload the round';
  }
  if (match.p2 === null || match.outcome !== 'pending') {
    return 'Only a table still playing can receive a time extension';
  }
  const changed = extendedMatch(match, command);
  const rounds = pod.rounds.map(r =>
    r === round ? { ...r, matches: r.matches.map(m => (m === match ? changed : m)) } : r
  );
  return { ...tournament, pods: tournament.pods.map(p => (p === pod ? { ...p, rounds } : p)) };
}

function extensionError(command: ExtensionCommand): string | null {
  if (!Number.isInteger(command.seconds) || command.seconds < 0 || command.seconds > MAX_EXTENSION_SECONDS) {
    return 'Time extensions are up to 60 minutes';
  }
  if (command.reason.length > EXTENSION_REASON_MAX) {
    return 'Keep the reason to 200 characters';
  }
  return null;
}

function samePairing(a: Match, b: Pick<Match, 'table' | 'p1' | 'p2'>): boolean {
  return a.table === b.table && a.p1 === b.p1 && a.p2 === b.p2;
}

function extendedMatch(match: Match, command: ExtensionCommand): Match {
  const { timeExtension: _previous, ...bare } = match;
  return command.seconds === 0
    ? bare
    : {
        ...bare,
        timeExtension: { seconds: command.seconds, reason: command.reason.trim() }
      };
}

/** File sync preserves site extensions only while the same players still occupy the table. */
export function keepTimeExtensions(round: Round, held?: Round): Match[] {
  const extensions = new Map(held?.matches.map(match => [pairingKey(match), match.timeExtension]) ?? []);
  return round.matches.map(match => {
    const { timeExtension: _uploaded, ...bare } = match;
    const extension = extensions.get(pairingKey(match));
    return extension ? { ...bare, timeExtension: extension } : bare;
  });
}

const pairingKey = (match: Match) => JSON.stringify([match.table, match.p1, match.p2]);
