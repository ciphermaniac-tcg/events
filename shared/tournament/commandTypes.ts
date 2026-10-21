/** The organizer command API: what a command says, what it runs with, and what it returns. */

import type { ExtensionCommand } from './timeExtensions.js';
import type { Random } from './random.js';
import type { Division, Outcome, PodCategory, Tournament, TournamentInfo } from './types.js';

export interface NewPlayer {
  firstName: string;
  lastName: string;
  /** POP ID; one is generated when blank. */
  id?: string;
  birthDate?: string;
  /** Set when the player's own decklist submission adds them (see functions/api/tournaments/[code]/decklists.ts). */
  fromList?: boolean;
}

export type Command =
  | ExtensionCommand
  | { type: 'addPlayer'; player: NewPlayer }
  | { type: 'editPlayer'; id: string; firstName: string; lastName: string; birthDate: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'dropPlayer'; id: string }
  | { type: 'disqualifyPlayer'; id: string }
  | { type: 'undropPlayer'; id: string }
  | { type: 'setFixedTable'; id: string; table: number | null }
  | { type: 'pairRound'; pod: PodCategory }
  | { type: 'repairRound'; pod: PodCategory; keepReported: boolean }
  | { type: 'deleteRound'; pod: PodCategory }
  | { type: 'startClock'; pod: PodCategory }
  | { type: 'stopClock'; pod: PodCategory }
  | { type: 'adjustClock'; pod: PodCategory; seconds: number }
  | {
      type: 'reportResult';
      pod: PodCategory;
      round: number;
      table: number;
      /** Both players name the match, so a report cannot land on a pairing made since it was sent. */
      p1: string;
      p2: string | null;
      outcome: Outcome;
      /**
       * The result the sender saw standing ('pending' while open), so one entered
       * on another device since is not overwritten unseen. Older consoles send none.
       */
      expected?: Outcome;
    }
  | { type: 'swapPlayers'; pod: PodCategory; a: string; b: string }
  | { type: 'startTopCut'; pod: PodCategory; size: number; division?: Division; playoff3rd4th?: boolean }
  | { type: 'concludePrerelease'; pod: PodCategory }
  | { type: 'updateInfo'; info: Partial<Pick<TournamentInfo, EditableInfo>> };

export type EditableInfo =
  'name' | 'city' | 'state' | 'country' | 'roundTime' | 'finalsRoundTime' | 'startDate' | 'eventType';

export interface CommandContext {
  /** Epoch ms. */
  now: number;
  /** A Play! Pokémon event, held to what makes one valid (see SANCTIONED). */
  sanctioned?: boolean;
  /** The same moment as TOM writes times: MM/DD/YYYY HH:mm:ss at the venue. */
  localTime: string;
  season: number;
  random: Random;
}

export type CommandResult =
  { ok: true; tournament: Tournament } | { ok: false; error: string; tournament?: Tournament };
