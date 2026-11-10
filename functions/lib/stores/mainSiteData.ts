/**
 * The main site's data bucket, read over HTTP: r2.ciphermaniac.com serves it
 * publicly, so this site binds nothing of the main site's to read the event
 * locator's league files (functions/lib/stores/leagues.ts).
 */

import type { ReadBucket } from '../types.js';

export const MAIN_SITE_DATA_ORIGIN = 'https://r2.ciphermaniac.com';

/** A league file read that takes longer than this is abandoned, as a miss or failure is. */
const TIMEOUT_MS = 3000;

/** A read-only bucket over the main site's data origin; a miss, failure or timeout reads as absent. */
export function mainSiteData(origin: string = MAIN_SITE_DATA_ORIGIN): ReadBucket {
  return {
    get: async key => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(`${origin}/${key.split('/').map(encodeURIComponent).join('/')}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          void response.body?.cancel();
          return null;
        }
        const text = await response.text();
        return { text: async () => text };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
