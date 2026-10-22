/**
 * The event page's registration tab. While players can register, the form
 * (see RegistrationForm), opened on the registration this device or account
 * already holds. Once registration closes, or round 1 is paired and every
 * list is locked, a receipt: the list as it was sent, read-only. A list that
 * cannot be read is said to be so, with a retry, and never taken for none:
 * until the device knows whether a list is in, nothing is sent over it.
 */

import { createMemo, createResource, Show } from 'solid-js';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { type Decklist, lookUpRegistration } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { msg, t } from '../../lib/i18n';
import { emptyProfile } from './ProfileFields';
import { recall } from './decklistMemory';
import { RegistrationForm } from './RegistrationForm';

interface FormProps {
  code: string;
  /** Unsanctioned, the form asks for the name alone. */
  sanctioned: boolean;
  /**
   * Whose list the signed-in account owns here, when it is a player: its POP
   * ID, or the full name of its Claim. A device that kept no list reads the
   * account's with it, and no token.
   */
  owner: ListOwner | null;
  /** Whether players can register now; when not, the page shows the receipt. */
  open: boolean;
  /** Round 1 is paired, which locks every list (see decklistsLocked). */
  locked: boolean;
  /** The start as players read it, which is when changes close; null when none is set. */
  closes: string | null;
  /** Check-in as players read it; null when none is set. */
  checkIn: string | null;
  /** The event's own list is at its cap. */
  full: boolean;
}

type ListOwner = Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>;

/** This device's list, by the details and token it kept; on a device that kept none, the account's own. */
async function loadMine([code, owner]: readonly [string, ListOwner | null]): Promise<Decklist | null> {
  const kept = recall(code);
  if (kept) {
    return (await lookUpRegistration(code, kept.profile ?? emptyProfile(), { token: kept.token })).mine;
  }
  return owner ? (await lookUpRegistration(code, owner)).mine : null;
}

/** Whether the device knows its list yet: still reading it, the read failed, or known (a list, or none). */
type ListState = 'loading' | 'failed' | 'known';

/** The asker's own list as the server has it, read once for the form and the receipt alike. */
function createMyList(props: FormProps) {
  // eslint-disable-next-line solid/reactivity -- read once for the event the page opened on
  const kept = recall(props.code);
  // Read again only for another owner, not for every new copy of the event the props come from; a device's own list has none.
  const whose = createMemo(() => [props.code, kept ? null : props.owner] as const, undefined, {
    equals: (a, b) => a[0] === b[0] && a[1] === b[1]
  });
  const [mine, { refetch }] = createResource(whose, loadMine);
  const state = (): ListState => {
    if (mine.error) {
      return 'failed';
    }
    return mine.state === 'ready' || mine.state === 'refreshing' ? 'known' : 'loading';
  };
  return { state, retry: () => void refetch(), current: () => latestValue(mine) ?? null };
}

type MyList = ReturnType<typeof createMyList>;

/** What a list not known yet says. */
const UNKNOWN: Record<Exclude<ListState, 'known'>, string> = {
  loading: msg('Checking for your decklist…'),
  failed: msg('Your decklist could not be loaded')
};

/** A list being read, or unreadable with a retry. */
function ListStatus(props: { list: MyList }) {
  const failed = () => props.list.state() === 'failed';
  return (
    <section class='tm-box tm-reg'>
      <div class='tm-box-bar tm-decklist-status'>
        <strong role={failed() ? 'alert' : undefined}>
          {t(UNKNOWN[props.list.state() as Exclude<ListState, 'known'>])}
        </strong>
        <Show when={failed()}>
          <button type='button' class='btn btn-secondary tm-small' onClick={() => props.list.retry()}>
            {t('Try again')}
          </button>
        </Show>
      </div>
    </section>
  );
}

/** The list as it was sent, read-only, once players can no longer change it. */
function Receipt(props: FormProps & { list: MyList }) {
  return (
    <section class='tm-box tm-reg'>
      <Show when={props.list.current()}>
        {mine => (
          <>
            <div class='tm-box-bar tm-reg-head'>
              <span class='tm-reg-who'>
                <strong>
                  {mine().firstName} {mine().lastName}
                </strong>
              </span>
            </div>
            <div class='tm-box-bar'>
              <Show
                when={mine().mode === 'digital'}
                fallback={<span class='muted'>{t('Hand your paper decklist to staff at check-in.')}</span>}
              >
                <Show when={mine().deck} fallback={<span class='muted'>{t('Cards deleted after the event')}</span>}>
                  <pre class='tm-decklist-sent'>{mine().deck}</pre>
                </Show>
              </Show>
            </div>
          </>
        )}
      </Show>
      <p class='tm-box-bar muted'>
        {props.locked ? t('Registration closed when round 1 was paired.') : t('Registration is closed.')}
      </p>
    </section>
  );
}

export function DecklistForm(props: FormProps) {
  const list = createMyList(props);
  return (
    <Show when={list.state() === 'known'} fallback={<ListStatus list={list} />}>
      <Show when={props.open} fallback={<Receipt {...props} list={list} />}>
        {/* Made again for each list read: another owner's list is another player's registration. */}
        <Show when={[list.current()] as const} keyed>
          {([mine]) => (
            <RegistrationForm
              code={props.code}
              sanctioned={props.sanctioned}
              closes={props.closes}
              checkIn={props.checkIn}
              full={props.full}
              mine={mine}
            />
          )}
        </Show>
      </Show>
    </Show>
  );
}
