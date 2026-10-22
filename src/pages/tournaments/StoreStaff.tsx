/**
 * Store settings' Staff: everyone in the store with what they are, each made
 * a Manager or Staff or taken out in place, and the invite links. A link lets
 * one person in, as the role it was made for, for a week; its address shows
 * only as it is made, and every link still open is listed to withdraw. The
 * Owner's row has no actions: the Owner alone hands the store to someone
 * else, from that person's row, and becomes a Manager, free to leave.
 */

import { useNavigate } from '@solidjs/router';
import { createResource, createSignal, For, Show } from 'solid-js';
import type { GivenRole, StoreRole } from '../../../shared/accounts/stores';
import type { StoreInvite, StoreMember } from '../../../shared/accounts/types';
import { errorText } from '../../lib/tournament/api';
import { t } from '../../lib/i18n';
import { dayOf } from '../../lib/tournament/applications';
import {
  createInvite,
  fetchPeople,
  inviteId,
  inviteLink,
  removeMember,
  setMemberRole,
  STORE_ROLE_WORDS,
  withdrawInvite
} from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { OptionsMenu } from './OptionsMenu';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { refreshSession, session } from './session';

const inviteWord = (role: GivenRole) => (role === 'manager' ? t('Manager invite') : t('Staff invite'));
const inviteLabel = (role: GivenRole) => (role === 'manager' ? t('Manager invite link') : t('Staff invite link'));

/**
 * One open link: as what it lets someone in and until when, and Withdraw. The
 * one just made also shows its address, the only time it can, with Copy.
 */
function InviteRow(props: { invite: StoreInvite; link: string | null; busy: boolean; onWithdraw: () => void }) {
  const [copied, setCopied] = createSignal(false);
  async function copy(link: string) {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div class='tm-box-bar tm-store-invite'>
      <span class='tm-store-invite-what'>
        {inviteWord(props.invite.role)}
        <span class='muted'> · {t('expires {date}', { date: dayOf(props.invite.expiresAt) })}</span>
      </span>
      <Show when={props.link}>
        {link => (
          <div class='tm-store-invite-box'>
            <span class='tm-set-inline tm-invite'>
              <input
                class='tm-input tm-link'
                readOnly
                value={link()}
                aria-label={inviteLabel(props.invite.role)}
                onFocus={e => e.currentTarget.select()}
              />
              <button type='button' class='btn btn-secondary' onClick={() => void copy(link())}>
                {copied() ? t('Copied') : t('Copy')}
              </button>
            </span>
            <span class='muted tm-small tm-invite-hint'>
              {t("Anyone with a Ciphermaniac account can join your store's organizer team with this one-time link.")}
            </span>
          </div>
        )}
      </Show>
      <button type='button' class='btn btn-ghost tm-small' disabled={props.busy} onClick={() => props.onWithdraw()}>
        {t('Withdraw')}
      </button>
    </div>
  );
}

/** The Owner's way to hand the store to this person, asked in a dialog: only the new Owner can hand it back. */
function HandOver(props: { member: StoreMember; busy: boolean; onHandOver: () => void }) {
  return (
    <ConfirmAction
      class='btn btn-ghost tm-small'
      label={t('Make owner')}
      question={t('Make {name} the owner?', { name: props.member.name })}
      scope={t('You become a manager, and only {name} can hand the store back.', { name: props.member.name })}
      confirmLabel={t('Make owner')}
      disabled={props.busy}
      onConfirm={() => props.onHandOver()}
    />
  );
}

/**
 * Making someone a Manager or Staff, asked first. A Manager making themselves
 * Staff loses the store's settings at once and can't take them back, so that
 * asks in a dialog, in the negative hue.
 */
function RoleChange(props: { member: StoreMember; you: boolean; busy: boolean; onRole: (role: GivenRole) => void }) {
  const to = (): GivenRole => (props.member.role === 'manager' ? 'staff' : 'manager');
  const stepping = () => props.you && to() === 'staff';
  const question = () => {
    if (stepping()) {
      return t('Make yourself staff?');
    }
    return to() === 'manager'
      ? t('Make {name} a manager?', { name: props.member.name })
      : t('Make {name} staff?', { name: props.member.name });
  };
  return (
    <ConfirmAction
      class='btn btn-ghost tm-small'
      label={to() === 'manager' ? t('Make manager') : t('Make staff')}
      question={question()}
      scope={
        stepping() ? t('You lose the store’s settings, and only the owner or a manager can give them back.') : undefined
      }
      danger={stepping()}
      disabled={props.busy}
      onConfirm={() => props.onRole(to())}
    />
  );
}

function MemberRow(props: {
  member: StoreMember;
  you: boolean;
  /** Whether the one looking is the store's Owner, who may hand it over. */
  owner: boolean;
  busy: boolean;
  onRole: (role: StoreRole) => void;
  onRemove: () => void;
}) {
  return (
    <tr>
      <td>
        {props.member.name}
        <Show when={props.you}>
          <span class='tm-flag is-you'>{t('You')}</span>
        </Show>
      </td>
      <td>{t(STORE_ROLE_WORDS[props.member.role])}</td>
      <td class='muted-cell tm-wide-col'>{props.member.hasPopId ? t('On file') : t('None')}</td>
      <td class='tm-extra-col'>
        <Show when={props.member.role !== 'owner'}>
          <OptionsMenu name={props.member.name} busy={props.busy} staff>
            <Show when={props.owner}>
              <HandOver member={props.member} busy={props.busy} onHandOver={() => props.onRole('owner')} />
            </Show>
            <RoleChange member={props.member} you={props.you} busy={props.busy} onRole={props.onRole} />
            <ConfirmAction
              class='btn btn-ghost tm-small'
              label={props.you ? t('Leave') : t('Remove')}
              question={props.you ? t('Leave this store?') : t('Remove {name}?', { name: props.member.name })}
              scope={props.you ? t('Only a new invite from a manager lets you back in.') : undefined}
              confirmLabel={props.you ? t('Leave') : t('Remove')}
              danger
              disabled={props.busy}
              onConfirm={() => props.onRemove()}
            />
          </OptionsMenu>
        </Show>
      </td>
    </tr>
  );
}

export function StoreStaff(props: { storeId: string }) {
  const navigate = useNavigate();
  const [people, { mutate, refetch }] = createResource(() => props.storeId, fetchPeople);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // The link made last on this page, by the name the list gives it: its address is shown nowhere else.
  const [made, setMade] = createSignal<{ id: string; link: string } | null>(null);
  const me = () => latestValue(session)?.user?.id;

  async function act(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  // Each step reads the store and who is signed in as it is pressed, then runs on those.
  function changeRole(member: StoreMember, role: StoreRole) {
    const store = props.storeId;
    // A Manager who makes themselves Staff can no longer change the store: on to its page.
    const stepping = member.id === me() && role === 'staff';
    // Handing the store over makes the Owner a Manager, which the session's list of stores says.
    const handing = role === 'owner';
    void act(async () => {
      mutate(await setMemberRole(store, member.id, role));
      if (stepping || handing) {
        await refreshSession();
      }
      if (stepping) {
        navigate(`/stores/${store}`);
      }
    });
  }
  function remove(member: StoreMember) {
    const store = props.storeId;
    const leaving = member.id === me();
    void act(async () => {
      await removeMember(store, member.id);
      if (leaving) {
        await refreshSession();
        navigate('/');
        return;
      }
      await refetch();
    });
  }
  function invite(role: GivenRole) {
    const store = props.storeId;
    void act(async () => {
      const { token } = await createInvite(store, role);
      setMade({ id: await inviteId(token), link: inviteLink(location.origin, token) });
      await refetch();
    });
  }
  function withdraw(id: string) {
    const store = props.storeId;
    void act(async () => {
      await withdrawInvite(store, id);
      await refetch();
    });
  }

  return (
    <section class='tm-store-section' aria-labelledby='store-staff-head'>
      <h2 class='tm-subhead tm-box-head' id='store-staff-head'>
        {t('Staff')}
      </h2>
      <Show
        when={latestValue(people)}
        fallback={
          <Show when={people.error} fallback={<Skeleton height='160px' />}>
            <ErrorLine message={errorText(people.error)} />
          </Show>
        }
      >
        {current => (
          <div class='tm-box'>
            <div class='table-wrap'>
              <table class='data tm-store-staff'>
                <thead>
                  <tr>
                    <th>{t('Name')}</th>
                    <th>{t('Role')}</th>
                    <th class='tm-wide-col'>POP ID</th>
                    <th>
                      <span class='sr-only'>{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={current().members}>
                    {member => (
                      <MemberRow
                        member={member}
                        you={member.id === me()}
                        owner={current().members.some(one => one.id === me() && one.role === 'owner')}
                        busy={busy()}
                        onRole={role => changeRole(member, role)}
                        onRemove={() => remove(member)}
                      />
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <For each={current().invites}>
              {open => (
                <InviteRow
                  invite={open}
                  link={made()?.id === open.id ? (made()?.link ?? null) : null}
                  busy={busy()}
                  onWithdraw={() => withdraw(open.id)}
                />
              )}
            </For>
            <div class='tm-box-bar'>
              <button type='button' class='btn btn-secondary' disabled={busy()} onClick={() => invite('staff')}>
                {t('Invite staff')}
              </button>
              <button type='button' class='btn btn-ghost' disabled={busy()} onClick={() => invite('manager')}>
                {t('Invite a manager')}
              </button>
              <span class='muted'>
                {t('Staff run the store’s events. Managers also edit the store, its staff and league nights.')}
              </span>
            </div>
          </div>
        )}
      </Show>
      <ErrorLine message={error()} />
    </section>
  );
}
