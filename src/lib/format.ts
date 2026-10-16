import { ordinalSuffix } from './i18n/translate';

/**
 * Ordinal for a placement in the language shown ("1st", "22nd", "1.º").
 * Placements are ranks, not counts: rendering them bare reads as a quantity,
 * and a column of "1 / 797" invites the wrong comparison against the field
 * size beside it.
 */
export function ordinal(n: number): string {
  if (!Number.isFinite(n)) {
    return '—';
  }
  return `${Math.trunc(n)}${ordinalSuffix(n)}`;
}
