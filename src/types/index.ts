import type { WinRateAggregate } from '../../shared/data/archetypes/winRate';

export interface TournamentParticipant {
  tpId: number;
  playerId?: number | string | null;
  name: string;
  country?: string | null;
  placement?: number | null;
  points?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  opw?: string | number | null;
  oopw?: string | number | null;
  madePhase2?: boolean;
  madeTopCut?: boolean;
  decklistPublished?: boolean;
  deckId?: string | null;
  deckName?: string | null;
  icons?: string | null;
  dropRound?: number | null;
  dropped?: boolean;
  dqed?: boolean;
  late?: boolean;
}

interface SignatureCardEntry {
  name: string;
  set: string | null;
  number: string | null;
  pct: number;
}

export interface ArchetypeIndexEntry {
  /** Non-mirror match-points aggregate, published with the online index. */
  winRateAggregate?: WinRateAggregate;
  name: string;
  label: string;
  deckCount: number | null;
  percent: number | null;
  thumbnails: string[];
  signatureCards?: SignatureCardEntry[];
  /** At most two Limitless sprite slugs. */
  icons?: string[];
}
