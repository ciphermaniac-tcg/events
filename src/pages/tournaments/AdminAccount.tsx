/**
 * The account card the Users tab opens over its list, as a dialog: who the
 * account is, its POP ID and the stores it runs, and what an Admin may do to
 * it. Move to account… finds the account to give the POP ID to among the
 * accounts listed by what is typed, or past them by the exact POP ID, email
 * or account ID typed, then asks in a dialog naming both, and opens the
 * card of the account that holds it now; Clear asks in place. History
 * follows the POP ID. A Community organizer is revoked or reinstated, and a
 * store's Manager taken out of the store, as on the Organizers tab.
 */

import { A } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import type { AdminUser, RoleHolder, RunStore } from '../../../shared/accounts/types';
import { t } from '../../lib/i18n';
import { findAccounts, movePopId } from '../../lib/tournament/admin';
import { dayOf } from '../../lib/tournament/applications';
import { createAction } from './action';
import { Fact } from './AdminApplications';
import { Access, RemoveFromStore } from './AdminOrganizers';
import { ConfirmAction, ConfirmDialog } from './ConfirmAction';
import { ErrorLine } from './Field';
import { Modal } from './Modal';

/** Whether the account's name, username, email, POP ID or ID holds what was typed. */
export const fits = (user: AdminUser, query: string) =>
  [user.name, user.handle, user.email ?? '', user.popId ?? '', user.id].some(field =>
    field.toLowerCase().includes(query)
  );

/** The account's real name, or its @username while it has none. */
export const shownName = (user: AdminUser) => (user.name === user.handle ? `@${user.handle}` : user.name);

/** Its @username, unless that is already its name or the account was found without one. */
export const sideHandle = (user: AdminUser) => (user.handle && user.handle !== user.name ? `@${user.handle}` : '');

/** How many accounts the move's search offers at once. */
const MOVE_MATCHES = 5;

type Update = (change: (users: AdminUser[]) => AdminUser[]) => void;

/** The list with one account changed by `change`. */
const changeOne = (id: string, change: (user: AdminUser) => AdminUser) => (users: AdminUser[]) =>
  users.map(user => (user.id === id ? change(user) : user));

/**
 * Move to: a search over every account but this one, each match with its
 * Move, which asks first. Once moved, the account that took it opens. The
 * list holds the newest accounts only (see users.ts), so text it finds
 * nothing for is looked up exactly, which finds an older account too.
 */
function MoveSearch(props: {
  from: AdminUser & { popId: string };
  users: AdminUser[];
  update: Update;
  onMoved: (to: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = createSignal('');
  const [to, setTo] = createSignal<AdminUser | null>(null);
  const action = createAction();
  const listed = createMemo(() => {
    const q = query().trim().toLowerCase();
    return q ? props.users.filter(user => user.id !== props.from.id && fits(user, q)).slice(0, MOVE_MATCHES) : [];
  });
  const [looked] = createResource(
    () => listed().length === 0 && query().trim(),
    text =>
      findAccounts(text).then(
        answer => answer.accounts.map(account => ({ ...account, handle: '', stores: [] })),
        () => []
      )
  );
  const found = (): AdminUser[] =>
    listed().length > 0 || !query().trim()
      ? listed()
      : // Ready only: while the text's own lookup runs, the last text's answer is not shown for it.
        (looked.state === 'ready' ? looked() : []).filter(user => user.id !== props.from.id);
  async function move(target: AdminUser) {
    const { popId, id } = props.from;
    if (await action.run(() => movePopId(popId, target.id))) {
      const taken = changeOne(id, user => ({ ...user, popId: null }));
      const given = changeOne(target.id, user => ({ ...user, popId }));
      // An account found by lookup joins the list, so its card can open.
      props.update(users => given(taken(users.some(user => user.id === target.id) ? users : [...users, target])));
      props.onMoved(target.id);
    }
  }
  return (
    <div class='tm-move'>
      <div class='tm-move-head'>
        <label class='tm-label' for='move-to'>
          {t('Move {popId} to', { popId: props.from.popId })}
        </label>
        <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onCancel()}>
          {t('Cancel')}
        </button>
      </div>
      <input
        id='move-to'
        ref={el => queueMicrotask(() => el.focus())}
        class='search'
        type='search'
        placeholder={t('Find a user')}
        value={query()}
        onInput={event => setQuery(event.currentTarget.value)}
      />
      <Show
        when={found().length > 0}
        fallback={
          <Show when={query().trim()}>
            <p class='muted'>{t('No users.')}</p>
          </Show>
        }
      >
        <div class='table-wrap'>
          <table class='data'>
            <tbody>
              <For each={found()}>
                {user => (
                  <tr>
                    <td class='tm-move-match'>
                      {shownName(user)}{' '}
                      <span class='muted'>{[sideHandle(user), user.popId].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td class='num'>
                      <button
                        type='button'
                        class='btn btn-secondary tm-small'
                        disabled={action.busy()}
                        onClick={() => setTo(user)}
                      >
                        {t('Move')}
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <ErrorLine message={action.error()} />
      <ConfirmDialog
        open={to() !== null}
        question={t('Move {popId} to {name}?', { popId: props.from.popId, name: to()?.name ?? '' })}
        scope={t('{popId} and its history leave {from} for {to}, who joined {date}.', {
          popId: props.from.popId,
          from: props.from.name,
          to: to()?.name ?? '',
          date: dayOf(to()?.createdAt ?? 0)
        })}
        confirmLabel={t('Move')}
        onConfirm={() => {
          const target = to();
          if (target) {
            void move(target);
          }
        }}
        onClose={() => setTo(null)}
      />
    </div>
  );
}

function Facts(props: { user: AdminUser }) {
  const u = () => props.user;
  return (
    <dl class='tm-app-facts'>
      <Fact label={t('Username')} value={u().handle && `@${u().handle}`} />
      <Fact label={t('Email')} value={u().email} />
      <Fact label={t('POP ID')} value={u().popId ?? t('None')} />
      <For each={u().stores}>
        {store => (
          <div>
            <dt>{t('Store')}</dt>
            <dd>
              <A href={`/stores/${encodeURIComponent(store.id)}`}>{store.name}</A>
            </dd>
          </div>
        )}
      </For>
      <div>
        <dt>{t('Account ID')}</dt>
        <dd class='tm-mono tm-select-all'>{u().id}</dd>
      </div>
      <Fact label={t('Joined')} value={dayOf(u().createdAt)} />
    </dl>
  );
}

/** The card's buttons: the POP ID's Move and Clear, then each store's Remove and the role's Revoke or Reinstate. */
function Actions(props: { user: AdminUser; update: Update; moving: boolean; onMove: () => void }) {
  const u = () => props.user;
  const action = createAction();
  async function clear(popId: string) {
    if (await action.run(() => movePopId(popId, null))) {
      props.update(changeOne(u().id, user => ({ ...user, popId: null })));
    }
  }
  const roleChanged = (account: RoleHolder) =>
    props.update(changeOne(account.id, user => ({ ...user, role: account.role })));
  const storeLeft = (store: RunStore) =>
    props.update(changeOne(u().id, user => ({ ...user, stores: user.stores.filter(one => one.id !== store.id) })));
  return (
    <>
      <span class='tm-row-actions'>
        <Show when={u().popId}>
          {popId => (
            <>
              <Show when={!props.moving}>
                <button type='button' class='btn btn-secondary tm-small' onClick={() => props.onMove()}>
                  {t('Move to account…')}
                </button>
              </Show>
              <ConfirmAction
                label={t('Clear')}
                question={t('Clear {popId} from {name}?', { popId: popId(), name: u().name })}
                danger
                disabled={action.busy()}
                onConfirm={() => void clear(popId())}
              />
            </>
          )}
        </Show>
        <For each={u().stores.filter(store => store.role === 'manager')}>
          {store => <RemoveFromStore account={u()} store={store} onRemoved={() => storeLeft(store)} />}
        </For>
        <Access account={u()} onChanged={roleChanged} />
      </span>
      <ErrorLine message={action.error()} />
    </>
  );
}

/** The card of the account `id` names, over the list; `onOpen` opens another, or with null closes it. */
export function AccountCard(props: {
  id: string;
  users: AdminUser[];
  update: Update;
  onOpen: (id: string | null) => void;
}) {
  const [moving, setMoving] = createSignal(false);
  // Close shuts the dialog the way Escape does, so focus goes back to the row.
  const [shut, setShut] = createSignal(false);
  const user = () => props.users.find(one => one.id === props.id);
  return (
    <Show when={user()}>
      {u => (
        <Modal
          open={!shut()}
          title={shownName(u())}
          class='tm-account-dialog'
          bar={
            <button type='button' class='btn btn-ghost tm-small tm-account-close' onClick={() => setShut(true)}>
              {t('Close')}
            </button>
          }
          onClose={() => props.onOpen(null)}
        >
          <div class='tm-account'>
            <Facts user={u()} />
            <Actions user={u()} update={props.update} moving={moving()} onMove={() => setMoving(true)} />
            <Show when={moving() && u().popId}>
              {popId => (
                <MoveSearch
                  from={{ ...u(), popId: popId() }}
                  users={props.users}
                  update={props.update}
                  onMoved={to => props.onOpen(to)}
                  onCancel={() => setMoving(false)}
                />
              )}
            </Show>
          </div>
        </Modal>
      )}
    </Show>
  );
}
