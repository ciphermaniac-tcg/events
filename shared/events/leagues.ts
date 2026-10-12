import type { EventKind } from './types';

export const LEAGUES_ROOT = 'events/leagues/v1';

/** Which listing a shard comes from. */
export type LeagueSource = 'sanctioned' | 'locals';
export const LEAGUE_SOURCES: readonly LeagueSource[] = ['sanctioned', 'locals'];

/** One event pokemon.com lists for a league, as a store would run it. */
export interface LeagueListing {
  sanctionId: string;
  kind: EventKind;
  name: string;
  /** Venue-local YYYY-MM-DD. */
  date: string;
  /** Venue-local HH:MM, or '' when unlisted. */
  time: string;
}

export interface LeagueEntry {
  shop: string;
  address: string;
  city: string;
  region: string;
  cc: string;
  lat: number;
  lon: number;
  timeZone: string;
  /** Soonest first. */
  listings: LeagueListing[];
}

export interface LeagueShard {
  version: 1;
  leagues: Record<string, LeagueEntry>;
}

/** The shard a league's entry lives in: the last two digits of its ID. */
export const leagueShardOf = (leagueId: string): string => leagueId.slice(-2).padStart(2, '0');

export const leagueShardPath = (source: LeagueSource, shard: string): string =>
  `${LEAGUES_ROOT}/${source}/${shard}.json`;
