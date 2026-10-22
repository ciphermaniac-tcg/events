/**
 * Settings' Organizer box for an account that runs events at all: every way
 * it does, one row each. Community organizer, with Resign (it keeps and runs
 * the events it owns, and may join again) or Join; Admin, with the admin
 * page; each store it belongs to, with what it is there, its settings or page,
 * and Leave for anyone but the Owner, who hands the store over first; then
 * the way to apply for a store, unless the Application above has its own step.
 */

import { A } from '@solidjs/router';
import { For, Match, Show, Switch } from 'solid-js';
import { managesStore } from '../../../shared/accounts/stores';
import type { MyStore } from '../../../shared/accounts/types';
import { type Me } from '../../lib/tournament/api';
import { t } from '../../lib/i18n';
import { removeMember, resignCommunity, STORE_ROLE_WORDS } from '../../lib/tournament/stores';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { refreshSession } from './session';
import { SettingRow } from './SettingControls';
import { createAction } from './action';

/** What the account is at the store, and whether the store may still run events. */
const storeNote = (store: MyStore) => {
  const role = t(STORE_ROLE_WORDS[store.role]);
  return store.status === 'revoked' ? t('{role} · Revoked', { role }) : role;
};

/** The account's own standing as a Community organizer, or as an Admin, who needs none. */
function CommunityRow(props: { user: Me; busy: boolean; onResign: () => void }) {
  return (
    <Switch>
      <Match when={props.user.role === 'admin'}>
        <SettingRow label={t('Admin')}>
          <A class='btn btn-secondary' href='/admin'>
            {t('Admin page')}
          </A>
        </SettingRow>
      </Match>
      <Match when={props.user.role === 'community'}>
        <SettingRow label={t('Community organizer')}>
          <ConfirmAction
            class='btn btn-secondary'
            label={t('Resign')}
            question={t('Resign as a community organizer?')}
            confirmLabel={t('Resign')}
            danger
            disabled={props.busy}
            onConfirm={() => props.onResign()}
          />
        </SettingRow>
      </Match>
      <Match when={props.user.role === 'revoked'}>
        <SettingRow label={t('Community organizer')}>
          <span class='muted'>{t('Access removed')}</span>
        </SettingRow>
      </Match>
      <Match when={props.user.role === null}>
        <SettingRow label={t('Community organizer')}>
          <A class='btn btn-secondary' href='/apply'>
            {t('Join')}
          </A>
        </SettingRow>
      </Match>
    </Switch>
  );
}

function StoreRow(props: { store: MyStore; busy: boolean; onLeave: () => void }) {
  const manages = () => managesStore(props.store.role);
  return (
    <SettingRow label={props.store.name} note={storeNote(props.store)}>
      <span class='tm-set-inline'>
        <A
          class='btn btn-secondary'
          href={manages() ? `/stores/${props.store.id}/settings` : `/stores/${props.store.id}`}
        >
          {manages() ? t('Store settings') : t('Store page')}
        </A>
        <Show when={props.store.role !== 'owner'}>
          <ConfirmAction
            class='btn btn-ghost'
            label={t('Leave')}
            question={t('Leave {store}?', { store: props.store.name })}
            scope={t('Only a new invite from a manager lets you back in.')}
            confirmLabel={t('Leave')}
            danger
            disabled={props.busy}
            onConfirm={() => props.onLeave()}
          />
        </Show>
      </span>
    </SettingRow>
  );
}

/** `applying`: an Application is pending or was turned down, and the status above offers its own step. */
export function OrganizerRoles(props: { user: Me; applying: boolean }) {
  const action = createAction();
  async function act(step: () => Promise<unknown>) {
    await action.run(async () => {
      await step();
      await refreshSession();
    });
  }
  /** Leaves the store as the account reads when Leave is confirmed. */
  function leave(storeId: string) {
    const userId = props.user.id;
    void act(() => removeMember(storeId, userId));
  }
  return (
    <>
      <div class='tm-box'>
        <CommunityRow user={props.user} busy={action.busy()} onResign={() => void act(resignCommunity)} />
        <For each={props.user.stores}>
          {store => <StoreRow store={store} busy={action.busy()} onLeave={() => leave(store.id)} />}
        </For>
        <Show when={!props.applying}>
          <SettingRow label={props.user.stores.length > 0 ? t('Another store') : t('Store')}>
            <A class='btn btn-secondary' href='/apply'>
              {t('Apply for a store')}
            </A>
          </SettingRow>
        </Show>
      </div>
      <ErrorLine message={action.error()} />
    </>
  );
}
