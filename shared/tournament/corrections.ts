/**
 * Result corrections: changing a Swiss match's result after the next round
 * is paired, within the window the Tournament Rules Handbook allows. A match
 * record can be fixed during the next round, and "cannot be altered after the
 * second subsequent round is paired" (§5.3.1.1); a started round's pairings
 * do not change (§5.6). So round N is correctable while round N+1 is the
 * latest round of its pod and still Swiss, and a correction changes that one
 * match's result and nothing else: round N+1 keeps its pairings and results,
 * and round N+2 pairs from the corrected standings.
 *
 * The organizer or the event's head judge approves a correction, with a note
 * saying which slip and what was wrong. TOM keeps its own events' results, so
 * a TOM event is corrected in TOM.
 */

import { latestRound, pointsBefore } from './rounds.js';
import {
  type Match,
  type Outcome,
  type Pod,
  POD_CATEGORIES,
  type PodCategory,
  REPORTABLE_OUTCOMES,
  type Tournament
} from './types.js';

export const CORRECTION_LIMITS = { note: 500 } as const;

/** What staff send to correct a result: the match as they saw it, the result it should have, why, and the event's version then. */
export interface CorrectionRequest {
  pod: PodCategory;
  round: number;
  table: number;
  p1: string;
  p2: string;
  outcome: Outcome;
  note: string;
  /** The event's version the correction was previewed on; another write since refuses it. */
  version: number;
}

/** Who approved a correction: the organizer, alone when the event names no head judge, or the head judge. */
export type ApproverRole = 'organizer' | 'head-judge';

/** One correction on the event's record, as staff read it. */
export interface CorrectionEntry {
  id: string;
  pod: PodCategory;
  round: number;
  table: number;
  p1: string;
  p2: string;
  from: Outcome;
  to: Outcome;
  note: string;
  /** The approving account, by name; null once it is deleted. */
  approvedBy: string | null;
  role: ApproverRole;
  /** The organizer approved with no head judge named for the event. */
  alone: boolean;
  /** The round in progress when it was made: always the corrected round's next. */
  during: number;
  recordedAt: number;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const whole = (value: unknown, least: number) => Number.isInteger(value) && (value as number) >= least;

const CHECKS: [problem: string, ok: (value: Record<string, unknown>) => boolean][] = [
  ['Say which pod', value => POD_CATEGORIES.includes(value.pod as PodCategory)],
  ['Say which round', value => whole(value.round, 1)],
  ['Say which table', value => whole(value.table, 0)],
  ['Say which match', value => text(value.p1) !== '' && text(value.p2) !== ''],
  ['Choose the result it should have', value => REPORTABLE_OUTCOMES.includes(value.outcome as Outcome)],
  ['Say which slip and what was wrong', value => text(value.note) !== ''],
  [
    `Keep the note under ${CORRECTION_LIMITS.note} characters`,
    value => text(value.note).length <= CORRECTION_LIMITS.note
  ],
  ['Look at the event again first', value => whole(value.version, 1)]
];

/** A correction out of a request body, or why it is not one. Whether it fits the event is `correctionRefusal`'s to say. */
export function readCorrection(value: Record<string, unknown>): CorrectionRequest | string {
  const problem = CHECKS.find(([, ok]) => !ok(value));
  if (problem) {
    return problem[0];
  }
  return {
    pod: value.pod as PodCategory,
    round: value.round as number,
    table: value.table as number,
    p1: text(value.p1),
    p2: text(value.p2),
    outcome: value.outcome as Outcome,
    note: text(value.note),
    version: value.version as number
  };
}

/** How the event is run, as far as a correction cares: in TOM or on the site, and whether it has ended. */
export interface CorrectionContext {
  tom: boolean;
  finished: boolean;
}

/** Whether any division's top cut has been seeded in the pod. */
const cutStarted = (pod: Pod) => Object.values(pod.divisionCuts ?? {}).some(cut => cut?.playerIds !== undefined);

/** Why the event takes no corrections at all, or null. */
function eventRefusal(ctx: CorrectionContext): string | null {
  if (ctx.tom) {
    return 'This event runs in TOM. Correct the result in TOM, then sync.';
  }
  return ctx.finished ? 'The event has ended.' : null;
}

/**
 * Why round `round` of `pod` cannot be corrected now, or null: it must be a
 * Swiss round, the round before the pod's latest, and the latest still Swiss.
 */
export function roundRefusal(pod: Pod, round: number, ctx: CorrectionContext): string | null {
  const event = eventRefusal(ctx);
  if (event) {
    return event;
  }
  const latest = latestRound(pod);
  const corrected = pod.rounds.find(r => r.number === round);
  if (!latest || corrected?.kind !== 'swiss') {
    return `Round ${round} is not a Swiss round of this event.`;
  }
  if (latest.number > round + 1) {
    return `Round ${round} can no longer be corrected. Its records locked when round ${round + 2} was paired.`;
  }
  if (latest.kind !== 'swiss' || cutStarted(pod)) {
    return 'The top cut has started, so Swiss results can no longer be corrected here.';
  }
  return latest.number === round ? `Round ${round} is the current round. Change its results from its table.` : null;
}

/** The two-player match a correction names, as it stands now; undefined when it has changed. */
function matchOf(pod: Pod, request: Pick<CorrectionRequest, 'round' | 'table' | 'p1' | 'p2'>): Match | undefined {
  return pod.rounds
    .find(r => r.number === request.round)
    ?.matches.find(m => m.table === request.table && m.p1 === request.p1 && m.p2 === request.p2);
}

/**
 * The match a correction changes, as it stands now, or why the correction
 * cannot be made: the window (see roundRefusal), the match, and the result.
 */
export function correctableMatch(t: Tournament, request: CorrectionRequest, ctx: CorrectionContext): Match | string {
  const pod = t.pods.find(p => p.category === request.pod);
  if (!pod) {
    return 'That pod is not on this event.';
  }
  const window = roundRefusal(pod, request.round, ctx);
  if (window) {
    return window;
  }
  const match = matchOf(pod, request);
  if (!match) {
    return 'That match has changed. Look again.';
  }
  if (!REPORTABLE_OUTCOMES.includes(match.outcome)) {
    return 'That match has no result to correct.';
  }
  return match.outcome === request.outcome ? 'That is already its result.' : match;
}

/** The event with the correction made: the one match's result, stamped `timestamp`, and nothing else. */
export function correctedTournament(
  t: Tournament,
  request: Pick<CorrectionRequest, 'pod' | 'round' | 'table' | 'p1' | 'p2' | 'outcome'>,
  timestamp: string
): Tournament {
  const correct = (m: Match): Match =>
    m.table === request.table && m.p1 === request.p1 && m.p2 === request.p2
      ? { ...m, outcome: request.outcome, timestamp }
      : m;
  return {
    ...t,
    pods: t.pods.map(pod =>
      pod.category === request.pod
        ? {
            ...pod,
            rounds: pod.rounds.map(r => (r.number === request.round ? { ...r, matches: r.matches.map(correct) } : r))
          }
        : pod
    )
  };
}

/** A match of the round after the corrected one, with its players' match points going into it. */
export interface NextMatch {
  table: number;
  p1: string;
  p2: string;
  points: [number, number];
}

/**
 * The next round's matches with a corrected player in them, read against the
 * corrected record: what the handbook likens to a random pair-up or pair-down.
 * They stay as played.
 */
export function nextMatches(corrected: Tournament, request: Pick<CorrectionRequest, 'pod' | 'round' | 'p1' | 'p2'>) {
  const pod = corrected.pods.find(p => p.category === request.pod);
  const next = pod?.rounds.find(r => r.number === request.round + 1);
  if (!pod || !next) {
    return [];
  }
  const points = pointsBefore(pod, next.number);
  const touched = (id: string | null) => id === request.p1 || id === request.p2;
  return next.matches.flatMap((m): NextMatch[] =>
    m.p2 !== null && (touched(m.p1) || touched(m.p2))
      ? [{ table: m.table, p1: m.p1, p2: m.p2, points: [points.get(m.p1) ?? 0, points.get(m.p2) ?? 0] }]
      : []
  );
}
