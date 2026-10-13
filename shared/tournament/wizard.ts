import type { TournamentSettings } from './types.js';

export interface WizardControls {
  topCut: { selected: boolean; enabled: boolean };
  thirdPlace: { selected: boolean; enabled: boolean };
  lessSwiss: { selected: boolean; enabled: boolean };
  swissMinutes: { value: number; minimum: number; maximum: number; enabled: boolean };
  finalsMinutes: { value: number; minimum: number; maximum: number; enabled: boolean };
}

/** V27-1: initial controls, before the organizer chooses a cut or edits a time. */
export function wizardControls(
  t: { settings?: Pick<TournamentSettings, 'mode' | 'type'> },
  stored: { round?: number; finals?: number } = {}
): WizardControls {
  const mode = t.settings?.mode ?? 'CUSTOM';
  const type = t.settings?.type ?? 2;
  const prerelease = mode === 'PRERELEASE';
  const cut = mode === 'CUSTOM' ? type === 3 : mode === 'TCG1DAY';
  const minimum = { CUSTOM: 10, PRERELEASE: 20, LEAGUECHALLENGE: 30, TCG1DAY: 30 }[mode];
  const round = stored.round ?? 30;
  return {
    topCut: { selected: cut, enabled: true },
    thirdPlace: { selected: false, enabled: type === 1 },
    lessSwiss: { selected: false, enabled: false },
    swissMinutes: { value: prerelease ? Math.max(30, round) : round, minimum, maximum: 90, enabled: true },
    finalsMinutes: { value: stored.finals ?? (prerelease ? 30 : 75), minimum, maximum: 90, enabled: cut }
  };
}
