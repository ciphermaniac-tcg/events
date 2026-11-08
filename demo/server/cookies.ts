/**
 * The cookies the demo's requests carry. A page cannot read Set-Cookie from a
 * Response it builds (browsers strip it), so the functions' own cookies never
 * reach here; only the sign-in cookies do, which only the sign-in flows set,
 * and the demo signs its one account in itself (seed.ts).
 */

let jar: Record<string, string> = {};

/** The Cookie header the next request carries. */
export function cookieHeader(): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/** Sets one cookie: the demo's own sign-in. */
export function setCookie(name: string, value: string): void {
  jar = { ...jar, [name]: value };
}
