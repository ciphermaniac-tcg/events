/**
 * The calls the demo does not take: signing in or out, and ending the demo's
 * one account or wiping what it holds. The demo has nobody else to be, so
 * each would leave the visitor with no way back but Reset.
 */

const CLOSED: readonly { method?: string; path: RegExp }[] = [
  { path: /^\/api\/auth\// },
  { method: 'DELETE', path: /^\/api\/me$/ },
  { method: 'POST', path: /^\/api\/me\/data$/ }
];

/** The answer to a call the demo does not take, worded for the page to show; null for any other call. */
export function closedAnswer(method: string, path: string): Response | null {
  const closed = CLOSED.some(entry => (entry.method ?? method) === method && entry.path.test(path));
  return closed ? Response.json({ error: 'This isn’t part of the demo.' }, { status: 403 }) : null;
}
