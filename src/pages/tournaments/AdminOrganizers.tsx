/**
 * The admin page's Organizers tab: every account with a role, by name, with
 * its email, POP ID, role, when the role last changed and how many events it
 * owns. An Organizer's access is removed with Revoke and given back with
 * Reinstate, each asked first; an Admin is listed, never changed here.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import type { RoleHolder } from '../../../shared/accounts/types';
import { errorText } from '../../lib/tournament/api';
import { t, tc, tn } from '../../lib/i18n';
import { fetchRoleHolders, ROLE_WORDS, setOrganizerAccess } from '../../lib/tournament/admin';
import { dayOf } from '../../lib/tournament/applications';
import { resolved } from '../../lib/resource';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine, ResourceFallback } from './Field';

const eventCount = (n: number) => tn(n, '{n} event', '{n} events');

/** Revoke for a Community organizer, Reinstate for a revoked one; nothing for an Admin. */
function Access(props: { account: RoleHolder; onChanged: (account: RoleHolder) => void }) {
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
    <Show when={props.account.role !== 'admin'}>
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

function HolderRow(props: { account: RoleHolder; onChanged: (account: RoleHolder) => void }) {
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
      <td class='tm-person-role'>{t(ROLE_WORDS[a().role])}</td>
      <td class='muted-cell tm-num tm-nowrap tm-person-since'>{a().roleAt ? dayOf(a().roleAt as number) : ''}</td>
      <td class='num tm-person-events'>
        <span class='tm-wide-only'>{a().events}</span>
        <span class='tm-phone-only'>{eventCount(a().events)}</span>
      </td>
      <td class='tm-extra-col tm-person-acts'>
        <span class='tm-row-actions'>
          <Access account={a()} onChanged={props.onChanged} />
        </span>
      </td>
    </tr>
  );
}

export function AdminOrganizers() {
  const [list, { refetch, mutate }] = createResource(() => fetchRoleHolders().then(answer => answer.accounts));
  const changed = (account: RoleHolder) => mutate(prev => prev?.map(row => (row.id === account.id ? account : row)));
  return (
    <Show when={resolved(list)} fallback={<ResourceFallback resource={list} onRetry={() => void refetch()} small />}>
      {accounts => (
        <section class='tm-box'>
          <Show when={accounts().length > 0} fallback={<p class='tm-empty muted'>{t('No organizers yet')}</p>}>
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
                  <For each={accounts()}>{account => <HolderRow account={account} onChanged={changed} />}</For>
                </tbody>
              </table>
            </div>
          </Show>
        </section>
      )}
    </Show>
  );
}
