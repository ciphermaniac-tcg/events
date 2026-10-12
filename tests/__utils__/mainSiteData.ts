/**
 * The main site's data origin in memory: functions read the event locator's
 * league files from it over HTTP (functions/lib/stores/mainSiteData.ts), so a
 * test serves them by standing in for fetch. Requests elsewhere go to the
 * fetch that was there before; `down` makes the origin unreachable.
 */

import { MAIN_SITE_DATA_ORIGIN } from '../../functions/lib/stores/mainSiteData.ts';

export interface MainSiteData {
  files: Map<string, string>;
  down: boolean;
  restore: () => void;
}

export function serveMainSiteData(): MainSiteData {
  const previous = globalThis.fetch;
  const served: MainSiteData = {
    files: new Map(),
    down: false,
    restore: () => {
      globalThis.fetch = previous;
    }
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${MAIN_SITE_DATA_ORIGIN}/`)) {
      return previous(input, init);
    }
    if (served.down) {
      throw new TypeError('fetch failed');
    }
    const key = decodeURIComponent(url.slice(MAIN_SITE_DATA_ORIGIN.length + 1));
    const body = served.files.get(key);
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(body);
  }) as typeof fetch;
  return served;
}
