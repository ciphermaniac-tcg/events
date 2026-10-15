const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'] as const;

/**
 * The English ordinal suffix alone ("st", "nd", "rd", "th"). Separate from
 * {@link ordinal} for the callers that print the numeral themselves — a
 * four-digit placement wants its thousands separator, and
 * `1,699` + `th` beats re-implementing the grouping here.
 */
export function ordinalSuffix(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const teen = abs % 100;
  return teen >= 11 && teen <= 13 ? 'th' : (ORDINAL_SUFFIX[abs % 10] ?? 'th');
}

/**
 * English ordinal for a placement ("1st", "22nd", "113th"). Placements are
 * ranks, not counts: rendering them bare reads as a quantity, and a column of
 * "1 / 797" invites the wrong comparison against the field size beside it.
 * Teens are all "th" regardless of their last digit.
 */
export function ordinal(n: number): string {
  if (!Number.isFinite(n)) {
    return '—';
  }
  return `${Math.trunc(n)}${ordinalSuffix(n)}`;
}
