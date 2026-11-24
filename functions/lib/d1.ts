/** Reading what D1 hands back, in the two shapes the functions keep needing. */

/** The first row of one statement's result in a batch, or null when it found none. */
export function firstRow<T>(result: { results?: unknown[] } | undefined): T | null {
  return (result?.results?.[0] ?? null) as T | null;
}

/** Every row from one statement's result in a batch, or an empty array when it found none. */
export function rows<T>(result: { results?: unknown[] } | undefined): T[] {
  return (result?.results ?? []) as T[];
}

/** How many rows a write changed. */
export function rowsChanged(result: unknown): number {
  return (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
}

/** A condition every write of a batch holds to, with its bound values. */
export interface Guard {
  sql: string;
  values: unknown[];
}

/**
 * A lookup key that is `value` while `guard` holds and NULL otherwise. A
 * read keyed on it finds no row for anyone the guard refuses, and visits
 * none, since SQLite works the key out before it seeks. Without a guard it
 * is just `value`.
 */
export const keyHeldTo = (value: unknown, guard?: Guard): Guard =>
  guard ? { sql: `(SELECT ? WHERE ${guard.sql})`, values: [value, ...guard.values] } : { sql: '?', values: [value] };

/** Either condition, `first`'s values bound ahead of `second`'s. */
export const either = (first: Guard, second: Guard): Guard => ({
  sql: `(${first.sql}) OR (${second.sql})`,
  values: [...first.values, ...second.values]
});

/** Both conditions, `first`'s values bound ahead of `second`'s. */
export const both = (first: Guard, second: Guard): Guard => ({
  sql: `(${first.sql}) AND (${second.sql})`,
  values: [...first.values, ...second.values]
});
