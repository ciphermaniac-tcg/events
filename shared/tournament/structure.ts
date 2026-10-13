/**
 * Play! Pokémon's recommended structure for an event: how many Swiss rounds
 * and how big a top cut its attendance calls for. Its own module, since the
 * console's settings ask for it without the rest of what the pages derive.
 */

import type { EventType, Tournament, TournamentInfo } from './types.js';

/** TOM's root and Swiss round type, and its mode, for each kind of event. */
const EVENT_CODES: Record<EventType, { type: string; mode: string }> = {
  cup: { type: '3', mode: 'TCG1DAY' },
  challenge: { type: '2', mode: 'LEAGUECHALLENGE' },
  local: { type: '2', mode: 'CUSTOM' },
  prerelease: { type: '2', mode: 'PRERELEASE' }
};

/** What a new file says about itself: TOM 1.86, with the selected event mode. */
export function defaultRootAttrs(type: EventType, configured = true): [string, string][] {
  return [
    ['type', configured ? EVENT_CODES[type].type : '2'],
    ['stage', '1'],
    ['version', '1.86'],
    ['gametype', 'TRADING_CARD_GAME'],
    ['mode', EVENT_CODES[type].mode]
  ];
}

export const TOP_CUT_SIZES = [2, 4, 8, 16, 32] as const;

type Table = readonly (readonly [max: number, rounds: number, cut: number])[];

/** Tournament Rules Handbook §5.5.6, rev. September 1, 2026, by competitors per age division. */
const TABLES: Record<'cup' | 'challenge', { rows: Table; beyond: number }> = {
  cup: {
    rows: [
      [8, 3, 0],
      [12, 4, 4],
      [20, 5, 4],
      [32, 5, 8],
      [64, 6, 8],
      [128, 7, 8],
      [226, 8, 8],
      [409, 9, 8]
    ],
    beyond: 10
  },
  // Swiss only: a League Challenge has no top cut.
  challenge: {
    rows: [
      [8, 3, 0],
      [16, 4, 0],
      [32, 5, 0],
      [64, 6, 0],
      [128, 7, 0],
      [256, 8, 0],
      [512, 9, 0]
    ],
    beyond: 10
  }
};

/** The recommended Swiss rounds and top cut for a division's attendance at an event of this type. */
export function recommendedStructure(players: number, type: EventType = 'cup'): { rounds: number; cut: number } {
  const { rows, beyond } = TABLES[type === 'cup' ? 'cup' : 'challenge'];
  const row = rows.find(([max]) => players <= max);
  const rounds = (row?.[1] ?? beyond) + (type === 'prerelease' ? 2 : 0);
  return { rounds, cut: row?.[2] ?? (type === 'cup' ? 8 : 0) };
}

/** The kind of event a tournament is; one from before the choice existed is a League Cup. */
export function eventTypeOf(tournament: Pick<Tournament, 'info'>): EventType {
  return tournament.info.eventType ?? 'cup';
}

/** Imported Custom and Prerelease files retain their mode independently of a cut. */
export function importedEventType(mode: string, type: string | undefined): Pick<TournamentInfo, 'eventType'> {
  if (mode === 'CUSTOM') {
    return { eventType: 'local' };
  }
  if (mode === 'PRERELEASE') {
    return { eventType: 'prerelease' };
  }
  return mode === 'LEAGUECHALLENGE' && type !== '3' ? { eventType: 'challenge' } : {};
}

/**
 * What a sanctioned event needs to be valid: at least four competitors and
 * three Swiss rounds (Tournament Rules Handbook §5.2), and rounds of at least
 * 30 minutes, the shortest the TCG handbook allows (a best-of-three round
 * needs 50, which the organizer sets).
 */
export const SANCTIONED = { players: 4, swissRounds: 3, minutes: 30 } as const;

/** Why a sanctioned event cannot have these round lengths, or null when it can. */
export function sanctionedMinutesError(info: Pick<TournamentInfo, 'roundTime' | 'finalsRoundTime'>): string | null {
  return info.roundTime < SANCTIONED.minutes || info.finalsRoundTime < SANCTIONED.minutes
    ? `A sanctioned event’s rounds are at least ${SANCTIONED.minutes} minutes`
    : null;
}
