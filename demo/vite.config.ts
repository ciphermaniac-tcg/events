import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The demo at demo.events.ciphermaniac.com: the site, built with its server
 * running in the browser (server/index.ts). Published event pages are read
 * from the in-browser bucket at /demo-data; nothing reaches the real API.
 */
const repo = resolve(import.meta.dirname, '..');
const outDir = resolve(repo, 'dist-demo');

/**
 * The demo's own _headers, in place of the site's: a policy that lets the page
 * talk to itself and to the public card data, and nothing else (no sign-in
 * providers, no API), lets sql.js compile its WebAssembly, and keeps the demo
 * out of search. The inline scripts are the site's own, so their hashes are
 * taken from the site's policy.
 */
function demoHeaders(): Plugin {
  return {
    name: 'demo-headers',
    apply: 'build',
    closeBundle() {
      const site = readFileSync(resolve(repo, 'static/_headers'), 'utf8');
      const hashes = [...new Set(site.match(/'sha256-[^']+'/g) ?? [])].join(' ');
      const policy = [
        "default-src 'self'",
        `script-src 'self' 'wasm-unsafe-eval' ${hashes}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self'",
        "connect-src 'self' https://r2.ciphermaniac.com",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'self'"
      ].join('; ');
      writeFileSync(
        resolve(outDir, '_headers'),
        [
          '/*',
          '  Strict-Transport-Security: max-age=31536000',
          `  Content-Security-Policy: ${policy}`,
          '  X-Content-Type-Options: nosniff',
          '  Referrer-Policy: strict-origin-when-cross-origin',
          '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
          '  X-Robots-Tag: noindex',
          '/assets/*',
          '  Cache-Control: public, max-age=31536000, immutable',
          ''
        ].join('\n')
      );
    }
  };
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [solid(), demoHeaders()],
  publicDir: resolve(repo, 'static'),
  define: {
    'import.meta.env.VITE_EVENTS_DATA_ORIGIN': JSON.stringify('/demo-data')
  },
  resolve: { alias: { '~': resolve(repo, 'src') } },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false
  },
  server: {
    host: '127.0.0.1',
    port: 5195,
    strictPort: true,
    allowedHosts: ['botan.tail843dce.ts.net'],
    fs: { allow: [repo] }
  }
});
