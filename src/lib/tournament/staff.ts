/**
 * What only the organizer's pages say about an event: what ending it now
 * would leave unplayed, the words staff confirm and change results in, what
 * the players reported for an open match, and what split the top cut. Kept
 * apart from present.ts so the pages every visitor loads leave it out.
 */

import { isDisputed, oneDevice, type PlayerReport } from '../../../shared/tournament/reports';
import { percentLabel, type Standing } from '../../../shared/tournament/standings';
import { livePods } from '../../../shared/tournament/rounds';
import type { Match, Outcome, Pod, Tournament } from '../../../shared/tournament/types';
import type { PendingResult, TournamentMode, TournamentSettings } from '../../../shared/tournament/view';
import { ordinal } from '../format';
import { msg, t } from '../i18n';
import { type NextStep, nextStep, openWords, podLabel, podProgress, type SeatTag, swissPlanOf } from './present';

/** What a pod has left to play when the event ends: `where` names the pod while the event has several. */
export interface EndGap {
  where: string | null;
  detail: string;
}

interface EndingEvent {
  tournament: Tournament;
  pending: readonly PendingResult[];
  mode: TournamentMode;
  settings: TournamentSettings;
}

/** What a step still to take says in an ending's review; null for none. */
function stepGap(step: NextStep): string | null {
  if (step.kind === 'pair') {
    return t('Next: {step}', { step: step.label });
  }
  return step.kind === 'decide' && step.cut > 0 ? t('Top cut not played') : null;
}

/** What one pod has left: no round at all, open tables, or (on the site) a round or cut its plan still calls for. */
function podGap(event: EndingEvent, pod: Pod): string | null {
  const progress = podProgress(pod, event.pending);
  if (!progress.round) {
    return t('No rounds played');
  }
  if (progress.open > 0) {
    return t('{round}: {open}', { round: progress.label, open: openWords(progress.open, progress.round.kind) });
  }
  // TOM decides a TOM event's rounds, so only its open tables are the site's to know.
  return event.mode === 'tom'
    ? null
    : stepGap(nextStep(progress, false, swissPlanOf(event.tournament, pod, event.settings.roundCap)));
}

/**
 * What ending the event now would leave unplayed, for every End to review
 * before it asks: none when every pod has played out its plan. An event with
 * gaps can still be ended, as one cut short.
 */
export function endGaps(event: EndingEvent): EndGap[] {
  const pods = livePods(event.tournament);
  if (!pods.some(pod => pod.rounds.length > 0)) {
    return [{ where: null, detail: t('No rounds played') }];
  }
  return pods.flatMap(pod => {
    const detail = podGap(event, pod);
    return detail ? [{ where: pods.length > 1 ? podLabel(pod) : null, detail }] : [];
  });
}

const OUTCOME_WORDS: Partial<Record<Outcome, string>> = {
  tie: msg('Tie'),
  'double-loss': msg('Double loss'),
  pending: msg('Clear the result')
};

const winnerOf = (outcome: Outcome, match: Match) => (outcome === 'p1' ? match.p1 : outcome === 'p2' ? match.p2 : null);

/** An outcome in words, as staff confirm it: "Ash Ketchum wins", "Tie", "Clear the result". */
export function outcomeLabel(outcome: Outcome, match: Match, names: Map<string, string>): string {
  const winner = winnerOf(outcome, match);
  if (winner) {
    return t('{name} wins', { name: names.get(winner) ?? winner });
  }
  const words = OUTCOME_WORDS[outcome];
  return words ? t(words) : '';
}

const OUTCOME_NOUNS: Partial<Record<Outcome, string>> = {
  tie: msg('a tie'),
  'double-loss': msg('a double loss')
};

/** A result that stands, as a noun in a question: "Ash Ketchum’s win", "a tie". */
export function outcomeNoun(outcome: Outcome, match: Match, names: Map<string, string>): string {
  const winner = winnerOf(outcome, match);
  return winner ? t('{name}’s win', { name: names.get(winner) ?? winner }) : t(OUTCOME_NOUNS[outcome] ?? '');
}

/**
 * The question before a result that stands is changed, naming both sides so
 * a stray press on the other player cannot read as a routine entry:
 * "Change Ash’s win to Misty’s?", "Change Ash’s win to a tie?", "Clear Ash’s win?".
 */
export function changeQuestion(from: Outcome, to: Outcome, match: Match, names: Map<string, string>): string {
  const was = outcomeNoun(from, match, names);
  if (to === 'pending') {
    return t('Clear {from}?', { from: was });
  }
  const winner = winnerOf(to, match);
  return winner && winnerOf(from, match)
    ? t('Change {from} to {name}’s?', { from: was, name: names.get(winner) ?? winner })
    : t('Change {from} to {to}?', { from: was, to: outcomeNoun(to, match, names) });
}

const REPORT_WORDS: Partial<Record<Outcome, string>> = {
  tie: msg('Tie'),
  'double-loss': msg('Double loss')
};

/** A report tag's tooltip, whole: a lower-cased word inside it would read wrong in a language that capitalizes nouns. */
const REPORTED_TITLES: Record<string, string> = {
  Won: msg('Reported: won'),
  Lost: msg('Reported: lost'),
  Tie: msg('Reported: tie'),
  'Double loss': msg('Reported: double loss')
};

/**
 * What a report says, beside the player who sent it, in a word (their win or
 * loss, or the tie they called): the result cell beside it already says
 * Reported or Disputed, and a longer tag cut the name short.
 */
function reportTag(report: PlayerReport, match: Match, problem: boolean): SeatTag {
  const winner = winnerOf(report.outcome, match);
  const word = winner
    ? winner === report.by
      ? msg('Won')
      : msg('Lost')
    : (REPORT_WORDS[report.outcome] ?? msg('Reported'));
  return { text: t(word), word, title: t(REPORTED_TITLES[word] ?? 'Reported'), problem };
}

export interface StaffReport {
  /** Stands in for Open in the result cell. */
  label: string;
  problem: boolean;
  /** The whole story, for the label's tooltip and for assistive tech. */
  detail: string;
  /** Each reporter's tag, by player ID. */
  tags: Map<string, SeatTag>;
}

/**
 * What the players reported for an open match: one report, which staff can
 * take as it is, or two that differ, which count for nothing until staff
 * enter the result. The cell says which in a word, and each reporter's tag
 * says what they sent, so the row stays one line.
 */
export function staffReport(
  reports: readonly PlayerReport[],
  match: Match,
  names: Map<string, string>
): StaffReport | null {
  const [first, second] = reports;
  if (!first) {
    return null;
  }
  const said = (report: PlayerReport) =>
    t('{name}: {result}', {
      name: names.get(report.by) ?? report.by,
      result: outcomeLabel(report.outcome, match, names)
    });
  // Two agreeing reports from one device never settle on their own: one person may have spoken for both seats.
  const shared = Boolean(second && oneDevice(first, second));
  const disputed = isDisputed(reports);
  const problem = shared || disputed;
  const tags = new Map(reports.map(report => [report.by, reportTag(report, match, problem)]));
  if (shared) {
    return {
      label: t('One device'),
      problem,
      tags,
      detail: t('Both reports came from one device. Reported: {result}', {
        result: outcomeLabel(first.outcome, match, names)
      })
    };
  }
  return disputed
    ? {
        label: t('Disputed'),
        problem,
        tags,
        detail: t('Reports differ. {reports}', { reports: reports.map(said).join(t('; ')) })
      }
    : {
        label: t('Reported'),
        problem,
        tags,
        detail: t('Reported: {result}', { result: outcomeLabel(first.outcome, match, names) })
      };
}

/** What put the last player in above the first one out: points, then OWP, then OOWP. */
export function cutSplit(rows: readonly Standing[], cut: number): string | null {
  const inside = rows[cut - 1];
  const outside = rows[cut];
  if (!inside || !outside) {
    return null;
  }
  const places = { inside: ordinal(cut), outside: ordinal(cut + 1) };
  if (inside.points !== outside.points) {
    return t('{inside} and {outside} split on points: {a} / {b}', { ...places, a: inside.points, b: outside.points });
  }
  if (inside.owp !== outside.owp) {
    const rates = { a: percentLabel(inside.owp), b: percentLabel(outside.owp) };
    return t('{inside} and {outside} split on OWP: {a} / {b}', { ...places, ...rates });
  }
  const rates = { a: percentLabel(inside.oowp), b: percentLabel(outside.oowp) };
  return t('{inside} and {outside} split on OOWP: {a} / {b}', { ...places, ...rates });
}
