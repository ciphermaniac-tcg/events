/**
 * The drift rules that keep site sheets from undoing the package: colour
 * literals, a forked focus ring, and 16px fields scoped by width alone.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { checkSheet, parseRules } from '../../scripts/quality/designDrift.ts';

const rulesHit = (source: string) => checkSheet(source).map(({ rule, hit }) => `${hit.rule} ${rule.selector}`);

test('a rule knows the @media it sits in, and other at-rules are passed over', () => {
  const rules = parseRules(`
    @font-face { font-family: 'X'; src: url(x.woff2); }
    .a { color: var(--fg); }
    @media (max-width: 640px), (pointer: coarse) {
      .b { font-size: 16px; }
    }
    .c { color: var(--muted); }
  `);
  assert.deepEqual(
    rules.map(rule => [rule.selector, rule.media]),
    [
      ['.a', null],
      ['.b', '@media (max-width: 640px), (pointer: coarse)'],
      ['.c', null]
    ]
  );
});

test('a colour literal outside a token is drift; tokens, masks and providers’ own colours are not', () => {
  assert.deepEqual(
    rulesHit(`
      .scrim { background: color-mix(in srgb, #000 45%, transparent); }
      .frame { border: 6px solid rgb(58, 58, 54); }
      .surface { --tm-confirm-fill: #ffdb58; color: var(--fg); }
      .fade { mask-image: linear-gradient(90deg, transparent, #000 6%); }
      .tm-sso-google { background: #fff; }
      .tm-screen-join .tm-qr { background: #fff; }
    `),
    ['colour-literal .scrim', 'colour-literal .frame']
  );
});

test('a focus outline drawn at its own width is drift; the token and a colour change are not', () => {
  assert.deepEqual(
    rulesHit(`
      .tm-console :focus-visible { outline: 3px solid var(--focus-color); outline-offset: 3px; }
      .tm-badge:focus-visible { outline: var(--focus-width) solid var(--focus-color); }
      .tm-confirm:focus-visible { outline-color: var(--tm-confirm-ink); }
      .tm-input:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    `),
    ['focus-width-token .tm-console :focus-visible']
  );
});

test('a script-moved focus target may drop its ring; a control may not', () => {
  assert.deepEqual(
    rulesHit(`
      main.page[tabindex='-1']:focus { outline: none; }
      .tm-row:focus-visible { outline: none; }
    `),
    ['focus-suppressed .tm-row:focus-visible']
  );
});

test('16px fields scoped by width alone are drift; by width or touch they are not', () => {
  assert.deepEqual(
    rulesHit(`
      @media (max-width: 640px) {
        .tm-input, .tm-select { font-size: 16px; }
        .tm-page :is(input, select, textarea) { font-size: 16px !important; }
        .tm-fee-symbol { font-size: 16px; }
      }
      @media (max-width: 640px), (pointer: coarse) {
        .tm-admin .tm-input.tm-mono { font-size: 16px; }
      }
    `),
    ['touch-field-size .tm-input, .tm-select', 'touch-field-size .tm-page :is(input, select, textarea)']
  );
});
