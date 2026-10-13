/** A new Swiss event with no players yet. */

import { WIZARD_MAXIMUM_MINUTES, WIZARD_MINIMUM_MINUTES } from './wizard.js';
import type { EventType, Tournament, TournamentInfo } from './types.js';

export const DEFAULT_ROUND_MINUTES = 30;
export const DEFAULT_FINALS_MINUTES = 75;

export function emptyTournament(info: Partial<TournamentInfo> & { name: string }): Tournament {
  return {
    info: {
      sanctionId: '',
      city: '',
      state: '',
      country: '',
      roundTime: DEFAULT_ROUND_MINUTES,
      finalsRoundTime: info.eventType === 'prerelease' ? 30 : DEFAULT_FINALS_MINUTES,
      organizerPopId: '',
      organizerName: '',
      startDate: '',
      ...info
    },
    players: [],
    pods: []
  };
}

/** V27-1 input limits for Custom and Prerelease; existing site limits for other kinds. */
export function eventTimeLimits(type: EventType): { minimum: number; maximum: number } {
  if (type === 'local' || type === 'prerelease') {
    return {
      minimum: WIZARD_MINIMUM_MINUTES[type === 'local' ? 'CUSTOM' : 'PRERELEASE'],
      maximum: WIZARD_MAXIMUM_MINUTES
    };
  }
  return { minimum: 1, maximum: 180 };
}
