/**
 * The admin page's Organizers tab: every account with a role, by name, with
 * its email, POP ID, role, when the role last changed and how many events it
 * owns, and a row for each store an account owns or manages, naming the
 * store in the role. An Organizer's access is removed with Revoke and given
 * back with Reinstate, each asked first; a store's Manager is taken out of
 * the store with Remove from store, asked in a dialog; an Admin and a
 * store's Owner are listed, never changed here.
 */

import { A } from '@solidjs/router';
import { createResource, createSignal, For, Show } from 'solid-js';
import type { AccountRole } from '../../../shared/accounts/roles';
import type { RoleHolder, RunStore } from '../../../shared/accounts/types';
import { errorText } from '../../lib/tournament/api';
import { t, tc, tn, tx } from '../../lib/i18n';
import { fetchRoleHolders, removeFromStore, ROLE_WORDS, setOrganizerAccess } from '../../lib/tournament/admin';
import { dayOf } from '../../lib/tournament/applications';
import { STORE_ROLE_WORDS } from '../../lib/tournament/stores';
import { resolved } from '../../lib/resource';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine, ResourceFallback } from './Field';

const eventCount = (n: number) => tn(n, '{n} event', '{n} events');

/** What the account is at the store, the store's name a link to its page: "Manager, Maple Street Games". */
export function StoreRoleText(props: { store: RunStore }) {
  return (
    <>
      {tx('{role}, {store}', {
        role: t(STORE_ROLE_WORDS[props.store.role]),
        store: <A href={`/stores/${encodeURIComponent(props.store.id)}`}>{props.store.name}</A>
      })}
    </>
  );
}

/** Revoke for a Community organizer, Reinstate for a revoked one; nothing for anyone else. */
export function Access(props: {
  account: { id: string; name: string; role: AccountRole | null };
  onChanged: (account: RoleHolder) => void;
}) {
  const [error, setError] = createSignal<string | null>(null);
  const revoking = () => props.account.role === 'community';
  async function change() {
    setError(null);
    try {
      const { account } = await setOrganizerAccess(props.account.id, revoking() ? 'revoked' : 'community');
      props.onChanged(account);
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <Show when={props.account.role === 'community' || props.account.role === 'revoked'}>
      <ConfirmAction
        label={revoking() ? t('Revoke') : tc('organizer access', 'Reinstate')}
        question={
          revoking()
            ? t('Revoke access for {name}?', { name: props.account.name })
            : t('Reinstate access for {name}?', { name: props.account.name })
        }
        danger={revoking()}
        onConfirm={() => void change()}
      />
      <ErrorLine message={error()} />
    </Show>
  );
}

/** Takes a store's Manager out of the store, asked in a dialog that names both. */
export function RemoveFromStore(props: {
  account: { id: string; name: string };
  store: RunStore;
  onRemoved: () => void;
}) {
  const [error, setError] = createSignal<string | null>(null);
  async function remove() {
    setError(null);
    try {
      await removeFromStore(props.account.id, props.store.id);
      props.onRemoved();
    } catch (err) {
      setError(errorText(err));
    }
  }
  const names = () => ({ name: props.account.name, store: props.store.name });
  return (
    <>
      <ConfirmAction
        label={t('Remove from store')}
        question={t('Remove {name} from {store}?', names())}
        scope={t('{name} can no longer run {store} events. Their account stays.', names())}
        confirmLabel={t('Remove')}
        danger
        onConfirm={() => void remove()}
      />
      <ErrorLine message={error()} />
    </>
  );
}

function HolderRow(props: {
  account: RoleHolder;
  onChanged: (account: RoleHolder) => void;
  onRemoved: (account: RoleHolder) => void;
}) {
  const a = () => props.account;
  return (
    <tr classList={{ 'is-revoked': a().role === 'revoked' }}>
      <td class='tm-person-name'>{a().name}</td>
      <td class='muted-cell tm-person-email'>{a().email ?? ''}</td>
      <td class='tm-num tm-person-pop'>
        <Show when={a().popId}>
          {popId => (
            <>
              <span class='tm-phone-only'>{t('POP ID')} </span>
              {popId()}
            </>
          )}
        </Show>
      </td>
      <td class='tm-person-role tm-nowrap'>
        <Show when={a().store} fallback={<Show when={a().role}>{role => t(ROLE_WORDS[role()])}</Show>}>
          {store => <StoreRoleText store={store()} />}
        </Show>
      </td>
      <td class='muted-cell tm-num tm-nowrap tm-person-since'>{a().roleAt ? dayOf(a().roleAt as number) : ''}</td>
      <td class='num tm-person-events'>
        <span class='tm-wide-only'>{a().events}</span>
        <span class='tm-phone-only'>{eventCount(a().events)}</span>
      </td>
      <td class='tm-extra-col tm-person-acts'>
        <span class='tm-row-actions'>
          <Show
            when={a().store?.role === 'manager' && a().store}
            fallback={<Access account={a()} onChanged={props.onChanged} />}
          >
            {store => <RemoveFromStore account={a()} store={store()} onRemoved={() => props.onRemoved(a())} />}
          </Show>
        </span>
      </td>
    </tr>
  );
}

export function AdminOrganizers() {
  const [list, { refetch, mutate }] = createResource(() => fetchRoleHolders().then(answer => answer.accounts));
  const changed = (account: RoleHolder) =>
    mutate(prev => prev?.map(row => (row.id === account.id && !row.store ? account : row)));
  const removed = (account: RoleHolder) => mutate(prev => prev?.filter(row => row !== account));
  return (
    <Show when={resolved(list)} fallback={<ResourceFallback resource={list} onRetry={() => void refetch()} small />}>
      {accounts => (
        <section class='tm-box'>
          <Show when={accounts().length > 0} fallback={<p class='tm-empty muted'>{t('No organizers yet.')}</p>}>
            <div class='table-wrap'>
              <table class='data tm-people'>
                <thead>
                  <tr>
                    <th>{t('Name')}</th>
                    <th>{t('Email')}</th>
                    <th>{t('POP ID')}</th>
                    <th>{t('Role')}</th>
                    <th>{t('Since')}</th>
                    <th class='num'>{t('Events')}</th>
                    <th>
                      <span class='sr-only'>{t('Access')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={accounts()}>
                    {account => <HolderRow account={account} onChanged={changed} onRemoved={removed} />}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </section>
      )}
    </Show>
  );
}
