/**
 * Marks English the site shows but cannot translate where it is written: a
 * constant built at module scope, or a message the API sends back, which the
 * browser translates when it shows it. The catalog check
 * (scripts/check-translations.ts) collects every literal passed to these.
 * @module shared/i18n
 */

/** English to translate later. Returns its argument. */
export function msg(english: string): string {
  return english;
}

/**
 * English with values in it, as the API sends it: `msgf('Round {round} is
 * over', { round: 3 })` is "Round 3 is over". The browser matches the filled
 * text back to its key to translate it, so keep each `{value}` between words.
 */
export function msgf(english: string, values: Record<string, string | number>): string {
  return english.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
