/**
 * The archetype rules a list is read with (see shared/tournament/archetypes.ts):
 * the main site's archetype index for the current online meta, as its daily
 * run publishes it, so the rules follow the meta without a release here. One
 * read serves an isolate for six hours. An index that cannot be read leaves
 * the hand-kept rules alone: a list then goes in unnamed, for staff to name,
 * rather than failing to go in at all.
 */

import { type ArchetypeRule, rulesFromIndex } from '../../../shared/tournament/archetypes.js';

const INDEX_URL = 'https://r2.ciphermaniac.com/reports/Online%20-%20Last%2014%20Days/archetypes/index.json';
const KEEP_MS = 6 * 60 * 60 * 1000;
/** After a failed read, how long the isolate goes without asking again, so a site that is down does not slow every list. */
const RETRY_MS = 5 * 60 * 1000;
const WAIT_MS = 3000;

let held: { rules: ArchetypeRule[]; at: number } | null = null;

/** @internal exposed for tests */
export function _forgetRules(): void {
  held = null;
}

export async function archetypeRules(now = Date.now()): Promise<ArchetypeRule[]> {
  if (held && now - held.at < KEEP_MS) {
    return held.rules;
  }
  try {
    const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(WAIT_MS) });
    if (response.ok) {
      held = { rules: rulesFromIndex(await response.json()), at: now };
      return held.rules;
    }
  } catch {
    // Read below as a miss.
  }
  // An old copy beats none; without one, only the hand-kept rules read the list.
  held = { rules: held?.rules ?? [], at: now - KEEP_MS + RETRY_MS };
  return held.rules;
}
