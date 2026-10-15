/**
 * The admin page's Users tab: every account on the site, the newest first,
 * with its name and username, email, POP ID, role and when it joined. The
 * search narrows the list by any of those as it is typed.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import type { AdminUser } from '../../../shared/accounts/types';
import { fetchAllUsers, ROLE_WORDS } from '../../lib/tournament/admin';
import { dayOf } from '../../lib/tournament/applications';
import { resolved } from '../../lib/resource';
import { ResourceFallback } from './Field';

/** Whether the account's name, username, email, POP ID or ID holds what was typed. */
const fits = (user: AdminUser, query: string) =>
  [user.name, user.handle, user.email ?? '', user.popId ?? '', user.id].some(field =>
    field.toLowerCase().includes(query)
  );

function UserRow(props: { user: AdminUser }) {
  const u = () => props.user;
  return (
    <tr>
      <td>
        {u().name}
        <Show when={u().handle && u().handle !== u().name}>
          <span class='muted'> @{u().handle}</span>
        </Show>
      </td>
      <td class='muted-cell'>{u().email ?? ''}</td>
      <td class='tm-num'>{u().popId ?? ''}</td>
      <td class='tm-nowrap'>
        <Show when={u().role}>{role => ROLE_WORDS[role()]}</Show>
      </td>
      <td class='muted-cell tm-num tm-nowrap'>{dayOf(u().createdAt)}</td>
    </tr>
  );
}

export function AdminUsers() {
  const [list, { refetch }] = createResource(() => fetchAllUsers().then(answer => answer.users));
  const [query, setQuery] = createSignal('');
  return (
    <Show when={resolved(list)} fallback={<ResourceFallback resource={list} onRetry={() => void refetch()} small />}>
      {users => {
        const shown = () => users().filter(user => fits(user, query().trim().toLowerCase()));
        return (
          <section class='tm-box'>
            <div class='tm-box-bar'>
              <input
                class='search tm-grow'
                type='search'
                placeholder='Find a user'
                aria-label='Find a user'
                value={query()}
                onInput={e => setQuery(e.currentTarget.value)}
              />
            </div>
            <Show when={shown().length > 0} fallback={<p class='tm-empty muted'>No users</p>}>
              <div class='table-wrap'>
                <table class='data tm-admin-users'>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>POP ID</th>
                      <th>Role</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={shown()}>{user => <UserRow user={user} />}</For>
                  </tbody>
                </table>
              </div>
            </Show>
          </section>
        );
      }}
    </Show>
  );
}
