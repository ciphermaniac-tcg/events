/**
 * The archetype rules a list is read with (see shared/tournament/archetypes.ts):
 * Play! Limitless's deck categorization rules, as the main site's daily run
 * copies them to R2, so the rules follow Limitless without a release here
 * and without a Limitless key. One read serves an isolate for six hours.
 * Rules that cannot be read leave a list unnamed, for staff to name, rather
 * than failing to go in at all.
 */

import { type DeckRule, rulesFromPublished } from '../../../shared/tournament/archetypes.js';

const RULES_URL = 'https://r2.ciphermaniac.com/limitless/deck-rules.json';
const KEEP_MS = 6 * 60 * 60 * 1000;
/** After a failed read, how long the isolate goes without asking again, so a site that is down does not slow every list. */
const RETRY_MS = 5 * 60 * 1000;
const WAIT_MS = 3000;

let held: { rules: DeckRule[]; at: number } | null = null;
/** The read in flight, which requests that arrive during it share. */
let pending: Promise<DeckRule[]> | null = null;

/** @internal exposed for tests */
export function _forgetRules(): void {
  held = null;
}

export async function archetypeRules(now = Date.now()): Promise<DeckRule[]> {
  if (held && now - held.at < KEEP_MS) {
    return held.rules;
  }
  pending ??= read(now).finally(() => {
    pending = null;
  });
  return pending;
}

async function read(now: number): Promise<DeckRule[]> {
  try {
    const response = await fetch(RULES_URL, { signal: AbortSignal.timeout(WAIT_MS) });
    if (response.ok) {
      held = { rules: rulesFromPublished(await response.json()), at: now };
      return held.rules;
    }
  } catch {
    // Read below as a miss.
  }
  // An old copy beats none; without one, no rule reads the list.
  held = { rules: held?.rules ?? [], at: now - KEEP_MS + RETRY_MS };
  return held.rules;
}
