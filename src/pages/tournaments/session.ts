/**
 * Who is signed in, shared by every tournament page. Read once per page load
 * and refreshed after sign-in changes; the pages read it through `latestValue`
 * so a refresh never blanks them.
 */

import { createResource, createRoot } from 'solid-js';
import { fetchSession, type Session, signOut } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';

let revision = 0;

const [session, { refetch, mutate }] = createRoot(() =>
  createResource<Session>((_, { value }): Promise<Session> => {
    const requested = revision;
    return fetchSession()
      .catch(error => {
        const known = latestValue(session) ?? value;
        if (known) {
          return known;
        }
        throw error;
      })
      .then(answer => (requested === revision ? answer : (latestValue(session) ?? answer)));
  })
);

export { mutate as setSession, refetch as refreshSession, session };

/** A successful logout is authoritative even if the next session read fails. */
export async function leaveSession(): Promise<void> {
  await signOut();
  clearSession();
}

export function clearSession(): void {
  revision += 1;
  mutate(previous => ({ ...previous, user: null, providers: previous?.providers ?? [] }));
}
