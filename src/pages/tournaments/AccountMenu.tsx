/**
 * The dashboard's account button: the account's picture (or its initial),
 * opening a menu of the account's own pages. Stands in for the strip of
 * links (AccountStrip) the other tournament pages carry. The way to apply to
 * run events is here rather than on the page, since few accounts want it.
 */

import { A } from '@solidjs/router';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { isAdmin } from '../../../shared/accounts/roles';
import { canCreateEvents } from '../../../shared/accounts/stores';
import type { Me } from '../../lib/tournament/api';
import { t } from '../../lib/i18n';
import { SignOutButton } from './SignOutButton';
import '../../styles/pages/tournament-account-menu.css';

export function AccountMenu(props: { user: Me; pending: number }) {
  const [open, setOpen] = createSignal(false);
  const close = () => setOpen(false);
  const logout = <SignOutButton onError={() => setOpen(true)} />;
  let root: HTMLDivElement | undefined;
  const admin = () => isAdmin(props.user.role);
  const apply = () => !canCreateEvents(props.user.role, props.user.stores);

  onMount(() => {
    const away = (event: Event) => {
      if (root && !root.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open()) {
        setOpen(false);
        root?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    onCleanup(() => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    });
  });

  return (
    <div class='tm-acct' ref={root}>
      <button
        type='button'
        class='tm-acct-button'
        aria-label={t('Account')}
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <Show when={props.user.avatar} fallback={<span aria-hidden='true'>{props.user.name.slice(0, 1)}</span>}>
          {src => <img src={src()} alt='' width='34' height='34' />}
        </Show>
      </button>
      <Show when={open()}>
        <div class='tm-acct-menu'>
          <p class='tm-acct-id'>
            <strong>{props.user.name}</strong>
            <span class='muted'>@{props.user.handle}</span>
          </p>
          <Show when={props.user.publicProfile}>
            <A onClick={close} href={`/u/${props.user.handle}`}>
              {t('Public profile')}
            </A>
          </Show>
          <A onClick={close} href='/history'>
            {t('History')}
          </A>
          <A onClick={close} href='/settings'>
            {t('Settings')}
          </A>
          <Show when={admin()}>
            <A onClick={close} href='/admin'>
              {t('Admin')}
              <Show when={props.pending > 0}>
                <span class='tm-dash-count'>{props.pending}</span>
              </Show>
            </A>
          </Show>
          <Show when={apply()}>
            <A onClick={close} class='tm-acct-quiet' href='/apply'>
              {t('Apply to organize')}
            </A>
          </Show>
          {logout}
        </div>
      </Show>
    </div>
  );
}
