import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

const headers = readFileSync(new URL('../../static/_headers', import.meta.url), 'utf8');

function parseRules(source) {
  const rules = [];
  for (const line of source.split('\n')) {
    if (line.startsWith('/')) {
      rules.push({ path: line.trim(), directives: [] });
    } else if (/^\s+!? ?[\w-]+:?/.test(line)) {
      rules.at(-1).directives.push(line.trim());
    }
  }
  return rules;
}

/** A Pages path rule as a RegExp: `*` matches anything, `:name` one segment. */
function patternOf(path) {
  const parts = path.split(/(\*|:\w+)/);
  const source = parts
    .map(part => {
      if (part === '*') {
        return '.*';
      }
      return part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`);
}

/** Every value Pages would send for `name` on `path`, joined as it joins them. */
function headerValue(path, name, source = headers) {
  const values = [];
  for (const rule of parseRules(source)) {
    if (!patternOf(rule.path).test(path)) {
      continue;
    }
    for (const directive of rule.directives) {
      if (directive === `! ${name}`) {
        values.length = 0;
      } else if (directive.startsWith(`${name}:`)) {
        values.push(directive.slice(name.length + 1).trim());
      }
    }
  }
  return values.join(', ');
}

const cacheControl = (path, source = headers) => headerValue(path, 'Cache-Control', source);

test('Pages app routes and R2-only paths receive no custom cache policy', () => {
  for (const path of [
    '/live/testcup-2027',
    '/live/v1/schedule.json',
    '/releases/v1/online/aaaaaaaaaaaa/master.json',
    '/current.json',
    '/channels/shadow.json',
    '/manifest.webmanifest'
  ]) {
    assert.equal(cacheControl(path), '', path);
  }
});

test('bundles and fonts retain an unambiguous year-long policy', () => {
  for (const path of ['/assets/app-hash.js', '/fonts/inter.woff2']) {
    assert.equal(cacheControl(path), 'public, max-age=31536000, immutable', path);
  }
});

test('matching Pages rules merge values unless explicitly detached', () => {
  const source =
    '/reports/*\n  Cache-Control: public, max-age=21600\n/reports/Snapshots/*\n  Cache-Control: public, max-age=31536000, immutable';
  assert.equal(
    cacheControl('/reports/Snapshots/data.json', source),
    'public, max-age=21600, public, max-age=31536000, immutable'
  );
  assert.equal(
    cacheControl(
      '/reports/Snapshots/data.json',
      source.replace('/reports/Snapshots/*\n', '/reports/Snapshots/*\n  ! Cache-Control\n')
    ),
    'public, max-age=31536000, immutable'
  );
});

test('every page is HTTPS-only and refuses to be framed by another site', () => {
  for (const path of ['/', '/settings', '/host/ABC123', '/t/ABC123', '/assets/app-hash.js']) {
    assert.equal(headerValue(path, 'Strict-Transport-Security'), 'max-age=31536000', path);
    assert.ok(headerValue(path, 'Content-Security-Policy').includes("frame-ancestors 'self'"), path);
    assert.equal(headerValue(path, 'X-Frame-Options'), 'SAMEORIGIN', path);
  }
});

test('account and organizer pages stay out of search, public pages do not', () => {
  for (const path of [
    '/settings',
    '/account',
    '/welcome',
    '/history',
    '/apply',
    '/admin',
    '/host/ABC123',
    '/stores/join',
    '/stores/s1/settings'
  ]) {
    assert.equal(headerValue(path, 'X-Robots-Tag'), 'noindex', path);
  }
  for (const path of ['/', '/host', '/t/ABC123', '/u/reese', '/stores/s1', '/privacy', '/terms', '/cards']) {
    assert.equal(headerValue(path, 'X-Robots-Tag'), '', path);
  }
});

test('security policy blocks untrusted scripts and pins each bootstrap hash', () => {
  const policy = headerValue('/', 'Content-Security-Policy');
  assert.ok(policy.startsWith("default-src 'self'; script-src 'self' "));
  const scripts = policy.split(';').find(directive => directive.trim().startsWith('script-src '));
  assert.ok(!scripts.includes("'unsafe-inline'"));
  assert.ok(!scripts.includes("'unsafe-eval'"));
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const bootstrap = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(bootstrap.length, 2);
  for (const [, script] of bootstrap) {
    const hash = createHash('sha256').update(script).digest('base64');
    assert.ok(scripts.includes(`'sha256-${hash}'`));
  }
  for (const directive of ["object-src 'none'", "base-uri 'none'", "form-action 'self'"]) {
    assert.ok(policy.includes(directive));
  }
  assert.equal(headerValue('/', 'X-Content-Type-Options'), 'nosniff');
  assert.equal(headerValue('/', 'Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(headerValue('/', 'Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
});
