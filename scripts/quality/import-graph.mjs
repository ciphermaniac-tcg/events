import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

const roots = ['src', 'shared', 'functions', 'scripts', 'tests', '.github/scripts'];
const sourcePattern = /\.(?:tsx?|mts|mjs|js|css)$/;
const extensions = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx'];
// Static, side-effect, re-export and dynamic imports, CSS @import, and
// repo-rooted path literals such as a test's child-process entry file.
const specifierPatterns = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(?\s*['"]([^'"]+)['"]/g,
  /@import\s+(?:url\()?['"]([^'"]+)['"]/g,
  /['"]((?:src|shared|functions|scripts|tests)\/[\w./-]+\.(?:tsx?|mjs))['"]/g
];

/** Every import-like specifier written in a module's source text. */
export function specifiers(text) {
  return specifierPatterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => match[1]));
}

function candidateBase(from, specifier) {
  if (specifier.startsWith('.')) {
    return posix.join(posix.dirname(from), specifier);
  }
  if (specifier.startsWith('~/')) {
    return `src/${specifier.slice(2)}`;
  }
  return /^(?:src|shared|functions|scripts|tests)\//.test(specifier) ? specifier : null;
}

/** The repository file a specifier names, or null for packages and unknown paths. */
export function resolveSpecifier(from, specifier, files) {
  const base = candidateBase(from, specifier);
  if (base === null) {
    return null;
  }
  const stripped = base.replace(/\.js$/, '');
  const candidates = [...extensions.map(extension => base + extension), `${stripped}.ts`, `${stripped}.tsx`];
  return candidates.find(candidate => files.has(candidate)) ?? null;
}

/** Map each file to the files that import it, from `sources` (path -> text). */
export function importersOf(sources) {
  const files = new Set(sources.keys());
  const importers = new Map();
  for (const [file, text] of sources) {
    for (const specifier of specifiers(text)) {
      const target = resolveSpecifier(file, specifier, files);
      if (target !== null && target !== file) {
        importers.set(target, [...(importers.get(target) ?? []), file]);
      }
    }
  }
  return importers;
}

/** The changed files plus every file that reaches one through imports. */
export function affectedFiles(changed, importers) {
  const affected = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    for (const importer of importers.get(queue.pop()) ?? []) {
      if (!affected.has(importer)) {
        affected.add(importer);
        queue.push(importer);
      }
    }
  }
  return affected;
}

function walk(directory, relative, found) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = posix.join(relative, entry.name);
    if (entry.isDirectory() && entry.name !== 'fixtures') {
      walk(join(directory, entry.name), path, found);
    } else if (entry.isFile() && sourcePattern.test(entry.name)) {
      found.set(path, readFileSync(join(directory, entry.name), 'utf8'));
    }
  }
}

/** Read every source module under the repository's code roots. */
export function readSources(repository) {
  const found = new Map();
  for (const root of roots) {
    const directory = join(repository, root);
    if (statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
      walk(directory, root, found);
    }
  }
  return found;
}
