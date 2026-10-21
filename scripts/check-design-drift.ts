#!/usr/bin/env tsx
/**
 * Design-system drift check.
 *
 * A style guide that only documents the system is a suggestion. This is the
 * part that enforces it: every rule below encodes a ruling from /style, and
 * anything new that breaks one fails the build.
 *
 * Existing drift is not blocked — it is recorded in the baseline file and may
 * only ever shrink. That keeps the check shippable on a codebase mid-migration
 * while still making it impossible to add more. When a ruling is applied
 * everywhere, its baseline entries disappear and the check gets stricter for
 * free. A baseline entry that no longer matches anything is also a failure, so
 * the file cannot rot into a permanent amnesty.
 *
 * Usage:
 *   npx tsx scripts/check-design-drift.ts            # fail on new drift
 *   npx tsx scripts/check-design-drift.ts --list     # print every finding
 *   npx tsx scripts/check-design-drift.ts --update   # re-record the baseline
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSheet, parseRules } from './quality/designDrift';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'config', 'design-drift-baseline.json');
const UPDATE = process.argv.includes('--update');
const LIST = process.argv.includes('--list');

/**
 * Sheets that draw something other than UI. The social graphics canvas exports
 * at a fixed scale and must look identical in both modes, so it cannot read
 * live tokens; the label maker draws physical thermal ink on physical stock.
 * Both are documented exceptions on /style.
 */
const EXEMPT_SHEETS = ['pages/social-graphics.css', 'pages/label-maker.css'];

interface Finding {
  /** Stable identity across line moves: sheet + rule id + selector. */
  key: string;
  file: string;
  line: number;
  rule: string;
  message: string;
}

function sheetFiles(): string[] {
  return execSync('git ls-files src/styles', { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(f => f.endsWith('.css'));
}

function collectFindings(): Finding[] {
  const findings: Finding[] = [];
  for (const file of sheetFiles()) {
    const short = file.replace('src/styles/', '');
    if (EXEMPT_SHEETS.includes(short)) {
      continue;
    }
    for (const { rule, hit } of checkSheet(readFileSync(join(ROOT, file), 'utf8'))) {
      findings.push({
        key: `${short}|${hit.rule}|${rule.selector}`,
        file: short,
        line: rule.line,
        rule: hit.rule,
        message: hit.message
      });
    }
  }
  return findings;
}

/**
 * The namespacing ruling, checked across sheets rather than within one.
 *
 * Only an *identical selector* in two sheets is flagged. A page sheet adding
 * `.data td.mb-cell` to the shared table is extension and fine; two sheets both
 * writing `.snapshot-banner { ... }` is a conflict decided by load order, where
 * the loser is invisible and editing it appears to do nothing.
 */
function collectCollisions(): Finding[] {
  const owners = new Map<string, Set<string>>();
  for (const file of sheetFiles()) {
    const short = file.replace('src/styles/', '');
    if (short === 'tokens.css' || short === 'fonts.css') {
      continue;
    }
    for (const rule of parseRules(readFileSync(join(ROOT, file), 'utf8'))) {
      for (const selector of rule.selector.split(',').map(x => x.trim())) {
        if (!selector.startsWith('.')) {
          continue;
        }
        const set = owners.get(selector) ?? new Set<string>();
        set.add(short);
        owners.set(selector, set);
      }
    }
  }
  const findings: Finding[] = [];
  for (const [selector, sheets] of [...owners].sort()) {
    if (sheets.size < 2) {
      continue;
    }
    const list = [...sheets].sort();
    findings.push({
      key: `${list.join(',')}|selector-collision|${selector}`,
      file: list[0],
      line: 0,
      rule: 'selector-collision',
      message: `"${selector}" is declared in ${list.join(' and ')} — load order decides which wins`
    });
  }
  return findings;
}

function writeBaseline(keys: string[]): void {
  const unique = [...new Set(keys)].sort();
  writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        note: 'Known design drift, recorded so new drift fails the build. This list may only shrink — see scripts/check-design-drift.ts and the ledger on /style.',
        generated: new Date().toISOString().slice(0, 10),
        allowed: unique
      },
      null,
      2
    )}\n`
  );
  console.log(`design-drift: baseline updated with ${unique.length} known findings`);
}

function report(findings: Finding[], allowed: Set<string>): void {
  for (const f of [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`  ${allowed.has(f.key) ? 'known' : ' NEW '}  ${f.file}:${f.line}  [${f.rule}] ${f.message}`);
  }
  console.log(`\n${findings.length} findings, ${findings.filter(f => !allowed.has(f.key)).length} new`);
}

function runCheck(findings: Finding[]): void {
  const baseline: string[] = JSON.parse(readFileSync(BASELINE, 'utf8')).allowed;
  const allowed = new Set(baseline);
  const added = findings.filter(f => !allowed.has(f.key));
  const seen = new Set(findings.map(f => f.key));
  const stale = baseline.filter(k => !seen.has(k));

  if (LIST) {
    report(findings, allowed);
  }

  if (added.length > 0) {
    console.error(`\ndesign-drift: ${added.length} new violation(s) — see the drift ledger on /style\n`);
    for (const f of added) {
      console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.message}`);
    }
    console.error('\nFix them, or if the drift is deliberate, run: npx tsx scripts/check-design-drift.ts --update');
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error(`\ndesign-drift: ${stale.length} baseline entr(ies) no longer match anything.`);
    console.error('That usually means a ruling got applied — good. Re-record with --update so the check tightens:\n');
    for (const k of stale) {
      console.error(`  ${k}`);
    }
    process.exit(1);
  }

  console.log(`design-drift: no new drift (${baseline.length} known, tracked on /style)`);
}

const allFindings = [...collectFindings(), ...collectCollisions()];
if (UPDATE) {
  writeBaseline(allFindings.map(f => f.key));
} else {
  runCheck(allFindings);
}
