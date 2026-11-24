/**
 * The admin page's Users tab: every account on the site, the newest first,
 * with its name and username, email, POP ID, role and the stores it runs,
 * and when it joined. The search narrows the list by any of those as it is
 * typed. A row opens the account's card over the list (AdminAccount), where
 * its POP ID is moved or cleared and its role or store changed; the list
 * follows what the card changes.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import type { AdminUser } from '../../../shared/accounts/types';
import { fetchAllUsers, ROLE_WORDS } from '../../lib/tournament/admin';
import { t } from '../../lib/i18n';
import { dayOf } from '../../lib/tournament/applications';
import { resolved } from '../../lib/resource';
import { AccountCard, fits } from './AdminAccount';
import { StoreRoleText } from './AdminOrganizers';
import { ResourceFallback } from './Field';

function UserRow(props: { user: AdminUser; onOpen: () => void }) {
  const u = () => props.user;
  return (
    <tr onClick={() => props.onOpen()}>
      <td>
        {/* No handler: the press reaches the row's own. */}
        <button type='button' class='tm-user-open'>
          {u().name}
        </button>
        <Show when={u().handle && u().handle !== u().name}>
          <span class='muted tm-nowrap'> @{u().handle}</span>
        </Show>
      </td>
      <td class='muted-cell'>{u().email ?? ''}</td>
      <td class='tm-num'>{u().popId ?? ''}</td>
      <td class='tm-nowrap'>
        <Show when={u().role}>{role => <span class='tm-user-role'>{t(ROLE_WORDS[role()])}</span>}</Show>
        <For each={u().stores}>
          {store => (
            <span class='tm-user-role'>
              <StoreRoleText store={store} />
            </span>
          )}
        </For>
      </td>
      <td class='muted-cell tm-num tm-nowrap'>{dayOf(u().createdAt)}</td>
    </tr>
  );
}

export function AdminUsers() {
  const [list, { refetch, mutate }] = createResource(() => fetchAllUsers().then(answer => answer.users));
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal<string | null>(null);
  return (
    <Show when={resolved(list)} fallback={<ResourceFallback resource={list} onRetry={() => void refetch()} small />}>
      {users => {
        const shown = () => users().filter(user => fits(user, query().trim().toLowerCase()));
        return (
          <>
            <section class='tm-box'>
              <div class='tm-box-bar'>
                <input
                  class='search tm-grow'
                  type='search'
                  placeholder={t('Find a user')}
                  aria-label={t('Find a user')}
                  value={query()}
                  onInput={e => setQuery(e.currentTarget.value)}
                />
              </div>
              <Show when={shown().length > 0} fallback={<p class='tm-empty muted'>{t('No users.')}</p>}>
                <div class='table-wrap'>
                  <table class='data tm-admin-users'>
                    <thead>
                      <tr>
                        <th>{t('Name')}</th>
                        <th>{t('Email')}</th>
                        <th>{t('POP ID')}</th>
                        <th>{t('Role')}</th>
                        <th>{t('Joined')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={shown()}>{user => <UserRow user={user} onOpen={() => setOpen(user.id)} />}</For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </section>
            <Show when={open()} keyed>
              {id => (
                <AccountCard
                  id={id}
                  users={users()}
                  update={change => mutate(prev => prev && change(prev))}
                  onOpen={setOpen}
                />
              )}
            </Show>
          </>
        );
      }}
    </Show>
  );
}
