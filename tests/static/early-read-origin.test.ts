import assert from 'node:assert/strict';
import test from 'node:test';
import type { Plugin, ResolvedConfig } from 'vite';
import config from '../../vite.config.ts';

test('the early read in index.html goes to the origin Vite resolves for the app, .env files included', () => {
  const plugin = (config.plugins as Plugin[]).find(p => p.name === 'events-data-origin');
  const resolve = plugin?.configResolved as (config: ResolvedConfig) => void;
  const transform = plugin?.transformIndexHtml as (html: string) => string;
  resolve({ env: { VITE_DATA_ORIGIN: 'http://127.0.0.1:4320' } } as unknown as ResolvedConfig);
  assert.equal(transform('data-origin="%EVENTS_DATA_ORIGIN%"'), 'data-origin="http://127.0.0.1:4320"');
  resolve({ env: { VITE_DATA_ORIGIN: 'http://a', VITE_EVENTS_DATA_ORIGIN: 'http://b' } } as unknown as ResolvedConfig);
  assert.equal(
    transform('%EVENTS_DATA_ORIGIN%'),
    'http://b',
    'the events origin comes first, as in src/lib/constants.ts'
  );
});
