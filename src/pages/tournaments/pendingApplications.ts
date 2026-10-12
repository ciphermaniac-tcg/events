/**
 * How many store Applications wait on an Admin: the dot on the account button
 * in the site's head and the count on the dashboard's Admin tab read one
 * answer. Asked only for a signed-in Admin.
 */

import { createResource, createRoot } from 'solid-js';
import { isAdmin } from '../../../shared/accounts/roles';
import { fetchApplications } from '../../lib/tournament/admin';
import { latestValue } from '../../lib/resource';
import { session } from './session';

const [pending, { refetch }] = createRoot(() =>
  createResource(
    () => {
      const user = latestValue(session)?.user;
      return user && isAdmin(user.role) ? user.id : false;
    },
    () => fetchApplications('pending').then(answer => answer.applications.length)
  )
);

export const pendingApplications = (): number => latestValue(pending) ?? 0;

/** Count again, once an Admin has decided one. */
export function recountApplications(): void {
  void refetch();
}
