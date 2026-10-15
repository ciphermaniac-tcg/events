import type { WinRateAggregate } from '../../shared/data/archetypes/winRate';

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
