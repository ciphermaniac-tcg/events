/**
 * What the translation check reads: the English the code asks to translate,
 * and how a catalog answers it. Kept apart from the command so the tests can
 * feed it source text directly.
 * @module scripts/quality/translations
 */

import ts from 'typescript';
import { CONTEXT_MARK } from '../../src/lib/i18n/translate';

/** One English string the code translates. `plural` is set for `tn`, keyed by its plural form. */
export interface SourceKey {
  key: string;
  plural: boolean;
  file: string;
  line: number;
}

/** English left in markup, not passed through `t`: for whoever is translating a file, not a gate. */
export interface Unwrapped {
  file: string;
  line: number;
  text: string;
}

type CatalogEntry = string | Record<string, string>;

/** Calls whose first string argument is a catalog key. `jsonError` is the API's: the browser translates it. */
const KEY_CALLS = new Set(['t', 'tx', 'msg', 'msgf', 'jsonError']);
/** Attributes a person reads or hears. */
const READ_ATTRIBUTES = new Set(['placeholder', 'title', 'alt', 'aria-label', 'aria-description', 'label']);
const WORDS = /[A-Za-z]{2,}/;

const literal = (node: ts.Node | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
}

function keyOf(call: ts.CallExpression): { key: string; plural: boolean } | null {
  const name = calleeName(call);
  if (name === 'tc') {
    const [context, english] = [literal(call.arguments[0]), literal(call.arguments[1])];
    return context === null || english === null ? null : { key: `${english}${CONTEXT_MARK}${context}`, plural: false };
  }
  if (name === 'tn') {
    const other = literal(call.arguments[2]);
    return other === null ? null : { key: other, plural: true };
  }
  const key = name && KEY_CALLS.has(name) ? literal(call.arguments[0]) : null;
  return key === null ? null : { key, plural: false };
}

function unwrappedText(node: ts.Node): string | null {
  if (ts.isJsxText(node)) {
    const text = node.text.replace(/\s+/g, ' ').trim();
    return WORDS.test(text) ? text : null;
  }
  if (ts.isJsxAttribute(node) && READ_ATTRIBUTES.has(node.name.getText())) {
    const value = node.initializer && ts.isStringLiteral(node.initializer) ? node.initializer.text : null;
    return value && WORDS.test(value) ? value : null;
  }
  return null;
}

/** Every key a source file asks for, and the English it shows without asking. */
export function scanSource(file: string, text: string): { keys: SourceKey[]; unwrapped: Unwrapped[] } {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const keys: SourceKey[] = [];
  const unwrapped: Unwrapped[] = [];
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node): void => {
    const found = ts.isCallExpression(node) ? keyOf(node) : null;
    if (found) {
      keys.push({ ...found, file, line: lineOf(node) });
    }
    const shown = unwrappedText(node);
    if (shown) {
      unwrapped.push({ file, line: lineOf(node), text: shown });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { keys, unwrapped };
}

const placeholders = (text: string): string[] =>
  [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

function pluralProblems(key: string, forms: Record<string, string>, required: string[]): string[] {
  const problems = required.filter(form => !forms[form]).map(form => `"${key}" has no "${form}" form`);
  const allowed = new Set([...placeholders(key), 'n']);
  for (const [form, text] of Object.entries(forms)) {
    const unknown = placeholders(text).filter(name => !allowed.has(name));
    if (unknown.length) {
      problems.push(`"${key}" (${form}) names {${unknown.join('}, {')}}, which the English does not`);
    }
  }
  return problems;
}

function entryProblems(key: string, entry: CatalogEntry, plural: boolean, required: string[]): string[] {
  if (plural !== (typeof entry === 'object')) {
    return [`"${key}" is ${plural ? 'a count (tn) and needs plural forms' : 'not a count and needs plain text'}`];
  }
  if (typeof entry === 'object') {
    return pluralProblems(key, entry, required);
  }
  return sameSet(placeholders(key.split(CONTEXT_MARK)[0]), placeholders(entry))
    ? []
    : [`"${key}" and its translation do not share the same {placeholders}`];
}

export interface CatalogReport {
  /** Entries no code asks for any more: the English changed or went. Fails the check. */
  stale: string[];
  /** Entries that would show wrong: placeholders lost or invented, plural forms missing. Fails the check. */
  broken: string[];
  /** English no entry answers yet: shown in English. Reported, never a failure. */
  missing: string[];
}

/** How a catalog answers the keys. `required` is the plural forms the language needs besides `other`. */
export function checkCatalog(keys: SourceKey[], catalog: Record<string, CatalogEntry>, required: string[]) {
  const wanted = new Map(keys.map(key => [key.key, key.plural]));
  const report: CatalogReport = { stale: [], broken: [], missing: [] };
  for (const [key, entry] of Object.entries(catalog)) {
    const plural = wanted.get(key);
    if (plural === undefined) {
      report.stale.push(key);
      continue;
    }
    report.broken.push(...entryProblems(key, entry, plural, ['other', ...required]));
  }
  report.missing = [...wanted.keys()].filter(key => !Object.hasOwn(catalog, key));
  return report;
}

/** The plural forms a language must spell out: `one` where it has one. Others fall back to `other`. */
export const requiredForms = (locale: string): string[] =>
  new Intl.PluralRules(locale).resolvedOptions().pluralCategories.includes('one') ? ['one'] : [];
