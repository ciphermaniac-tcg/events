import { readFileSync } from 'node:fs';

/** The file the e2e build wrote for a source module that is an entry or loaded on demand. */
export function chunkOf(source: string): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../../.cache/e2e-dist/.vite/manifest.json', import.meta.url), 'utf8')
  ) as Record<string, { file: string }>;
  const chunk = manifest[source];
  if (!chunk) {
    throw new Error(`${source} has no chunk of its own`);
  }
  return chunk.file;
}
