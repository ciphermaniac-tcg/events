/**
 * Who is signed in, shared by every tournament page. Read once per page load
 * and refreshed after sign-in changes; the pages read it through `latestValue`
 * so a refresh never blanks them. A tab that was signed in opens on that
 * answer while it is read again (see accountMemory.ts).
 */

import { createEffect, createResource, createRoot, type ResourceOptions } from 'solid-js';
import { fetchSession, type Session, signOut } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { forgetAccountMemory, keepSession, keptSession } from '../../lib/tournament/accountMemory';

let revision = 0;
// Whether the server has answered this page: until then a kept session is not
// enough to stand on, and a failed read shows its error rather than hiding behind it.
let confirmed = false;

const kept = keptSession();
// Solid counts an initialValue key as an answer even when it holds nothing.
const options: ResourceOptions<Session> = kept ? { initialValue: kept } : {};

const [session, { refetch, mutate }] = createRoot(() => {
  const resource = createResource<Session>((_, { value }): Promise<Session> => {
    const requested = revision;
    return fetchSession()
      .then(answer => {
        confirmed = true;
        return answer;
      })
      .catch(error => {
        const known = confirmed ? (latestValue(session) ?? value) : undefined;
        if (known) {
          return known;
        }
        throw error;
      })
      .then(answer => (requested === revision ? answer : (latestValue(session) ?? answer)));
  }, options);
  // Every answer, read or set, so a profile saved in Settings opens saved next time.
  createEffect(() => {
    const answer = latestValue(resource[0]);
    if (answer) {
      keepSession(answer);
    }
  });
  return resource;
});

export { refetch as refreshSession, session };

/** Sets the session from a save's answer, which a read still under way must not then undo. */
export function setSession(update: Session | ((previous: Session | undefined) => Session | undefined)): void {
  revision += 1;
  mutate(previous => (typeof update === 'function' ? update(previous) : update));
}

/** A successful logout is authoritative even if the next session read fails. */
export async function leaveSession(): Promise<void> {
  await signOut();
  clearSession();
}

export function clearSession(): void {
  revision += 1;
  forgetAccountMemory();
  mutate(previous => ({ ...previous, user: null, providers: previous?.providers ?? [] }));
}
