import { nameKey } from './identify.js';
import type { Player } from './types.js';

/** Lookup tolerates one typo; reporting identity deliberately uses findPlayer instead. */
function oneEdit(a: readonly string[], b: readonly string[]): boolean {
  const mismatch = a.findIndex((letter, index) => letter !== b[index]);
  if (mismatch < 0) {
    return b.length - a.length <= 1;
  }
  const tail = a.slice(mismatch + 1).join('');
  const otherTail = b.slice(mismatch + 1).join('');
  if (a.length !== b.length) {
    return a.slice(mismatch).join('') === otherTail;
  }
  return (
    tail === otherTail ||
    (a[mismatch] === b[mismatch + 1] &&
      a[mismatch + 1] === b[mismatch] &&
      a.slice(mismatch + 2).join('') === b.slice(mismatch + 2).join(''))
  );
}

/** Case and diacritics are ignored; short names need exact spelling, longer names allow one edit. */
export function lookupNameFits(typed: string, recorded: string): boolean {
  const a = Array.from(nameKey(typed));
  const b = Array.from(nameKey(recorded));
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  if (a.join('') === b.join('')) {
    return true;
  }
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) {
    return false;
  }
  return a.length <= b.length ? oneEdit(a, b) : oneEdit(b, a);
}

/** All plausible candidates, without promoting even an exact match above another plausible player. */
export function lookupPlayers<T extends Pick<Player, 'firstName' | 'lastName'>>(
  players: readonly T[],
  query: { lastName: string; firstName?: string }
): T[] {
  const first = query.firstName?.trim();
  return players.filter(
    player => lookupNameFits(query.lastName, player.lastName) && (!first || lookupNameFits(first, player.firstName))
  );
}
