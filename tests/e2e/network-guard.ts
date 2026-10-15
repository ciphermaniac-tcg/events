/**
 * The browser tests' `test`: a page may reach the preview and fixture servers
 * and nothing else. A request anywhere else is refused and fails the test
 * that made it, so no test passes only because the real network answered.
 * @module tests/e2e/network-guard
 */

import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Where a sprite missing from the fixtures falls back to (components/ArchetypeIcon.tsx), drawn here with a local image. */
const SPRITE_FALLBACK_HOST = 'r2.limitlesstcg.net';
const SPRITE = readFileSync(new URL('../../static/img/substitute.png', import.meta.url));

export const test = base.extend<{ externalRequests: string[] }>({
  externalRequests: [
    async ({ context }, use) => {
      const refused: string[] = [];
      await context.route(
        url => !LOCAL_HOSTS.has(url.hostname),
        route => {
          const url = new URL(route.request().url());
          if (url.hostname === SPRITE_FALLBACK_HOST) {
            return route.fulfill({ contentType: 'image/png', body: SPRITE });
          }
          refused.push(url.href);
          return route.abort('blockedbyclient');
        }
      );
      await use(refused);
      expect(refused, 'requests that left the preview and fixture servers').toEqual([]);
    },
    { auto: true }
  ]
});
