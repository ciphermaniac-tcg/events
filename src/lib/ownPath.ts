/**
 * `next` as a path on this site (path, query and hash), or null when it
 * leads anywhere else. The browser reads it as a link would, so `/\evil.example`
 * and a path with a tab in it are judged where they actually go.
 */
export function ownPath(next: string, origin = globalThis.location.origin): string | null {
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return null;
  }
  return url.origin === origin ? url.pathname + url.search + url.hash : null;
}
