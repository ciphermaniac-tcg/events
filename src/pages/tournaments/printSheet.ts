/**
 * What a printed decklist says: the event at the top, the player under it,
 * then the list by section with each section's count. At a sanctioned event
 * the player line carries the Player ID, birth year and division, as the
 * official sheet asks; an unsanctioned one prints the name alone.
 */

import { type DeckCard, type DeckSection, parseDecklist } from '../../../shared/tournament/decklist';
import { birthYear, divisionFor, eventSeason, parseTomDate } from '../../../shared/tournament/divisions';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { isWallClock } from '../../../shared/tournament/timeZone';
import type { Division, Tournament } from '../../../shared/tournament/types';
import type { TournamentSettings } from '../../../shared/tournament/view';
import { intlLocale } from '../../lib/i18n';

export interface PrintSection {
  section: DeckSection;
  cards: DeckCard[];
  count: number;
}

export interface PrintSheet {
  event: { name: string; date: string; place: string; format: string; url: string };
  player: { name: string; popId: string; birthYear: number | null; division: Division | null };
  sections: PrintSection[];
  /** Lines the parser could not read as a card, printed as they were pasted. */
  unread: string[];
  total: number;
  submittedAt: number;
}

/** The event as a printed sheet needs it. */
export interface SheetEvent {
  code: string;
  settings: Pick<TournamentSettings, 'format' | 'startsAt' | 'venue'>;
  tournament: Tournament;
}

const ORDER: DeckSection[] = ['pokemon', 'trainer', 'energy'];

/** The event's day, always with its year: a sheet is kept long after it. */
function eventDate(startsAt: string, startDate: string): string {
  const date = isWallClock(startsAt) ? new Date(startsAt) : parseTomDate(startDate);
  if (!date) {
    return '';
  }
  return date.toLocaleDateString(intlLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(isWallClock(startsAt) ? {} : { timeZone: 'UTC' })
  });
}

export function printSheet(
  event: SheetEvent,
  list: PlayerProfile & { deck: string; submittedAt: number },
  sanctioned: boolean,
  origin: string
): PrintSheet {
  const { info } = event.tournament;
  const parsed = parseDecklist(list.deck);
  const sections = ORDER.map(section => {
    const cards = parsed.cards.filter(card => card.section === section);
    return { section, cards, count: cards.reduce((sum, card) => sum + card.count, 0) };
  }).filter(s => s.cards.length > 0);
  return {
    event: {
      name: info.name,
      date: eventDate(event.settings.startsAt, info.startDate),
      place: event.settings.venue || [info.city, info.state].filter(Boolean).join(', '),
      format: event.settings.format,
      url: `${origin}/t/${event.code}`
    },
    player: {
      name: `${list.firstName} ${list.lastName}`.trim(),
      popId: sanctioned ? list.popId : '',
      birthYear: sanctioned ? birthYear(list.birthDate) : null,
      division: sanctioned ? divisionFor(list.birthDate, eventSeason(event.tournament)) : null
    },
    sections,
    unread: parsed.unread,
    total: parsed.total,
    submittedAt: list.submittedAt
  };
}
