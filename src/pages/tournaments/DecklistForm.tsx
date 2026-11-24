/**
 * The event page's registration tab. While players can register, the form
 * (see RegistrationForm), opened on the registration this device or account
 * already holds. Once registration closes, or round 1 is paired and every
 * list is locked, a receipt: the list as it was sent, read-only. A list that
 * cannot be read is said to be so, with a retry, and never taken for none:
 * until the device knows whether a list is in, nothing is sent over it.
 */

import { Show } from 'solid-js';
import type { Decklist } from '../../lib/tournament/api';
import { msg, t } from '../../lib/i18n';
import type { ListState, MyList } from './myList';
import { RegistrationForm } from './RegistrationForm';

interface FormProps {
  code: string;
  /** Unsanctioned, the form asks for the name alone. */
  sanctioned: boolean;
  /** The registration the page read for this device or account (see myList.ts). */
  list: MyList;
  /**
   * What the form last said this device holds, once it sent or let one go:
   * newer than the read, so a form opened again starts from it.
   */
  held: Decklist | null | undefined;
  onHeld: (list: Decklist | null) => void;
  /** Whether players can register now; when not, the page shows the receipt. */
  open: boolean;
  /** Registrations may still be withdrawn (see canRegister). */
  withdrawable: boolean;
  /** The event takes decklists; when not, registering asks for none. */
  lists: boolean;
  /** The start as players read it, which is when changes close; null when none is set. */
  closes: string | null;
  /** The event's own list is at its cap. */
  full: boolean;
  /** The event's season, which places a birth year in its division. */
  season: number;
  /** A registration may still correct its birth year (see RegistrationForm). */
  years: boolean;
}

/** The device's registration as it stands: what the form last said, else what the page read. */
const mineOf = (held: Decklist | null | undefined, read: Decklist | null) => (held === undefined ? read : held);

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

/** Why the receipt shows: the viewer's list locked as round 1 or the round after they joined paired. */
const closedNote = (late: boolean): string =>
  late
    ? msg('Registration closed when the round after you joined was paired.')
    : msg('Registration closed when round 1 was paired.');

/** The list as it was sent, read-only, once players can no longer change it. */
function Receipt(props: FormProps) {
  return (
    <section class='tm-box tm-reg'>
      <Show when={mineOf(props.held, props.list.current())}>
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
      <p class='tm-box-bar muted'>{t(closedNote(mineOf(props.held, props.list.current())?.late === true))}</p>
    </section>
  );
}

/** Said over the form after round 1, to a viewer with no list: only a late entrant can still send one. */
const LATE_NOTE = msg('Round 1 has started. Only a player already in the event can send a late list.');

export function DecklistForm(props: FormProps) {
  // After round 1 a list held stays a receipt unless its own player may still send it; one not held may be theirs.
  const editable = () => props.withdrawable || (mineOf(props.held, props.list.current())?.editable ?? true);
  return (
    <Show when={props.list.state() === 'known'} fallback={<ListStatus list={props.list} />}>
      <Show when={props.open && editable()} fallback={<Receipt {...props} />}>
        {/* Made again for each list read: another owner's list is another player's registration. */}
        <Show when={[props.list.current()] as const} keyed>
          {([read]) => (
            <RegistrationForm
              code={props.code}
              sanctioned={props.sanctioned}
              closes={props.closes}
              full={props.full}
              mine={mineOf(props.held, read)}
              onHeld={list => props.onHeld(list)}
              withdrawable={props.withdrawable}
              lists={props.lists}
              season={props.season}
              years={props.years}
              note={props.withdrawable || mineOf(props.held, props.list.current()) ? undefined : t(LATE_NOTE)}
            />
          )}
        </Show>
      </Show>
    </Show>
  );
}
