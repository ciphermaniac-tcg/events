export interface ReturningPlayer {
  firstName: string;
  lastName: string;
  /** Empty when the previous event did not collect Play! Pokémon IDs. */
  popId: string;
  birthYear: number | null;
}

export const RETURNING_PLAYER_LIMIT = 8;

export function playerSearch(value: string): string {
  const query = value.trim();
  return query.length >= 2 && query.length <= 100 ? query : '';
}
