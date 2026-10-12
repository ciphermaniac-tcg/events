/**
 * The main site's data bucket, read over HTTP: r2.ciphermaniac.com serves it
 * publicly, so this site binds nothing of the main site's to read the event
 * locator's league files (functions/lib/stores/leagues.ts).
 */

import type { ReadBucket } from '../types.js';

export const MAIN_SITE_DATA_ORIGIN = 'https://r2.ciphermaniac.com';

/** A read-only bucket over the main site's data origin; a miss or failure reads as absent. */
export function mainSiteData(origin: string = MAIN_SITE_DATA_ORIGIN): ReadBucket {
  return {
    get: async key => {
      const response = await fetch(`${origin}/${key.split('/').map(encodeURIComponent).join('/')}`);
      if (!response.ok) {
        void response.body?.cancel();
        return null;
      }
      return { text: () => response.text() };
    }
  };
}
