/** A new Swiss event with no players yet. */

import { wizardControls } from './wizard.js';
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
    const controls = wizardControls({ settings: { mode: type === 'local' ? 'CUSTOM' : 'PRERELEASE', type: 2 } });
    return { minimum: controls.swissMinutes.minimum, maximum: controls.swissMinutes.maximum };
  }
  return { minimum: 1, maximum: 180 };
}
