#!/usr/bin/env tsx
/**
 * Translation catalog check.
 *
 * Every catalog in src/locales/ is keyed by the English the code passes to
 * `t`, `tn`, `tx` and `msg`, and by the messages the API sends through
 * `jsonError`. English is the source: a key no catalog answers simply shows
 * in English, so missing entries are only counted. What fails is an entry that
 * would mislead — one whose English no longer exists (the copy changed: move
 * the translation to the new key, or drop it), or one that loses or invents a
 * `{placeholder}`, or a count without the plural forms its language needs.
 *
 * Usage:
 *   npx tsx scripts/check-translations.ts               # fail on stale or broken entries
 *   npx tsx scripts/check-translations.ts --missing es  # list English Spanish lacks
 *   npx tsx scripts/check-translations.ts --unwrapped   # list markup English not passed through t
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCatalog, requiredForms, scanSource, type SourceKey, type Unwrapped } from './quality/translations';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = join(ROOT, 'src', 'locales');
const SOURCES = ['src', 'shared', 'functions'];
const args = process.argv.slice(2);
const missingFor = args.includes('--missing') ? args[args.indexOf('--missing') + 1] : null;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

const keys: SourceKey[] = [];
const unwrapped: Unwrapped[] = [];
for (const file of SOURCES.flatMap(directory => sourceFiles(join(ROOT, directory)))) {
  const found = scanSource(relative(ROOT, file), readFileSync(file, 'utf8'));
  keys.push(...found.keys);
  unwrapped.push(...found.unwrapped);
}

if (args.includes('--unwrapped')) {
  for (const item of unwrapped) {
    console.log(`${item.file}:${item.line}  ${item.text}`);
  }
  console.log(`${unwrapped.length} strings in markup outside t()`);
  process.exit(0);
}

const unique = new Set(keys.map(key => key.key)).size;
let failed = false;
for (const name of readdirSync(LOCALES).filter(entry => entry.endsWith('.json'))) {
  const locale = basename(name, '.json');
  const catalog = JSON.parse(readFileSync(join(LOCALES, name), 'utf8')) as Record<
    string,
    string | Record<string, string>
  >;
  const report = checkCatalog(keys, catalog, requiredForms(locale));
  const translated = unique - report.missing.length;
  console.log(`${locale}: ${translated}/${unique} translated (${Math.floor((translated / unique) * 100)}%)`);
  for (const key of report.stale) {
    console.error(`  stale: "${key}" is no longer in the code`);
  }
  for (const problem of report.broken) {
    console.error(`  broken: ${problem}`);
  }
  if (locale === missingFor) {
    for (const key of report.missing) {
      const where = keys.find(item => item.key === key);
      console.log(`  missing: ${where?.file}:${where?.line}  ${key}`);
    }
  }
  failed ||= report.stale.length > 0 || report.broken.length > 0;
}
process.exitCode = failed ? 1 : 0;
