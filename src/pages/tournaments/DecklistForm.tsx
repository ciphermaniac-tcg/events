/**
 * A player's decklist for the event, with no account: they say who they are
 * the way the rest of the player side does (Player ID, name and birth year at
 * a sanctioned event; the name at an unsanctioned one), pick an archetype
 * when the event tracks them, and paste the list from TCG Live. The parse
 * runs as they type, so a list that is short a card says so before it is
 * sent, and sending one with problems asks first.
 *
 * Submitting adds a player who is not on the event's list yet. The device
 * remembers who sent the list and the token the server gave it, so coming
 * back shows the list to update or withdraw. The list is locked to that
 * device: another one sending the same details is refused, until staff
 * unlock it. A signed-in player's profile fills the form in, and once a
 * list is in at a sanctioned event, the account can take its POP ID ("Save
 * to my account"): sending a list never sets one, since a list may be sent
 * for a friend. An account that owns its list sees it on any of its devices.
 *
 * Once submission closes, or round 1 is paired and every list is locked, the
 * form gives way to a receipt: the list as it was sent, read-only. A list
 * that cannot be read is said to be so, with a retry, and never taken for
 * none: until the device knows whether a list is in, nothing is sent over it.
 */

import { createEffect, createMemo, createResource, createSignal, For, Show, untrack } from 'solid-js';
import { type DeckSection, parseDecklist } from '../../../shared/tournament/decklist';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { SETTINGS_LIMITS } from '../../../shared/tournament/view';
import {
  ApiError,
  type Decklist,
  errorText,
  fetchMyDecklist,
  type Registration,
  saveProfile,
  submitDecklist,
  withdrawDecklist
} from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { DeckCombo } from '../live/LiveDeck';
import { ConfirmAction } from './ConfirmAction';
import { createDeckOptions } from './deckOptions';
import { ErrorLine } from './Field';
import { birthYearOf, emptyProfile, ProfileFields, profileProblems } from './ProfileFields';
import { session, setSession } from './session';
import { MAIN_SITE } from '../../lib/constants';
import { intlLocale, msg, t, tn } from '../../lib/i18n';
import { recall, remember } from './decklistMemory';

interface FormProps {
  code: string;
  archetypes: boolean;
  /** The event's format, whose archetypes the deck picker offers. */
  format: string;
  /** Unsanctioned, the form asks for the name alone. */
  sanctioned: boolean;
  /**
   * Whose list the signed-in account owns here, when it is a player: its POP
   * ID, or the full name of its Claim. A device that kept no list reads the
   * account's with it, and no token.
   */
  owner: ListOwner | null;
  /** Whether players can send a list now; when not, the page shows the receipt. */
  open: boolean;
  /** Round 1 is paired, which locks every list (see decklistsLocked). */
  locked: boolean;
}

type ListOwner = Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>;

/** This device's list, by the details and token it kept; on a device that kept none, the account's own. */
async function loadMine([code, owner]: readonly [string, ListOwner | null]): Promise<Decklist | null> {
  const kept = recall(code);
  if (kept) {
    return (await fetchMyDecklist(code, kept.profile ?? emptyProfile(), kept.token)).mine;
  }
  return owner ? (await fetchMyDecklist(code, owner, '')).mine : null;
}

const SECTION_LABELS: Record<DeckSection, string> = {
  pokemon: msg('Pokémon'),
  trainer: msg('Trainer'),
  energy: msg('Energy')
};

const submittedAt = (at: number) =>
  new Date(at).toLocaleString(intlLocale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' });

const REGISTRATION_WORDS: Record<Registration, (name: string) => string> = {
  added: () => t('Added you to the event'),
  matched: name => t("You're in the event as {name}", { name }),
  'not-added': () => t('Not added to the event')
};

/** Where the list stands, built from what the server said: sent when, and whether they are in the event. */
function statusLine(mine: Decklist | null, registration: Registration | null, count: string, problems: number) {
  return mine
    ? submittedLine(mine, registration)
    : `${count}${problems ? ` · ${tn(problems, '{n} problem', '{n} problems')}` : ''} · ${t('Not submitted')}`;
}

function submittedLine(mine: Decklist, registration: Registration | null) {
  const name = `${mine.firstName} ${mine.lastName}`;
  const where = registration
    ? REGISTRATION_WORDS[registration](name)
    : mine.registered
      ? t("You're in the event as {name}", { name })
      : t('Not on the player list yet');
  return `${t('Submitted {when}', { when: submittedAt(mine.submittedAt) })} · ${where}`;
}

/** What is still missing before the list can go, for the one line under a disabled Submit. */
function missing(profile: PlayerProfile, deck: string, sanctioned: boolean): string | null {
  const problems = profileProblems(profile, sanctioned);
  const labels: Record<keyof PlayerProfile, string> = {
    popId: t('Player ID'),
    firstName: t('first name'),
    lastName: t('last name'),
    birthDate: t('birth year')
  };
  const needed = (Object.keys(labels) as (keyof PlayerProfile)[]).filter(key => problems[key]).map(key => labels[key]);
  if (!deck.trim()) {
    needed.push(t('list'));
  }
  const last = needed.pop();
  if (last === undefined) {
    return null;
  }
  const fields = needed.length ? t('{items} and {last}', { items: needed.join(', '), last }) : last;
  return t('Add your {fields}', { fields });
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
  const [mine, { mutate, refetch }] = createResource(whose, loadMine);
  const state = (): ListState => {
    if (mine.error) {
      return 'failed';
    }
    return mine.state === 'ready' || mine.state === 'refreshing' ? 'known' : 'loading';
  };
  return {
    kept,
    whose,
    mine,
    mutate,
    state,
    retry: () => void refetch(),
    current: () => latestValue(mine) ?? null
  };
}

type MyList = ReturnType<typeof createMyList>;

/** What a list not known yet says, in the status bar and beside the Submit it holds back. */
const UNKNOWN: Record<ListState, string | null> = {
  loading: msg('Checking for your decklist…'),
  failed: msg('Your decklist could not be loaded'),
  known: null
};

const unknownText = (state: ListState) => {
  const text = UNKNOWN[state];
  return text ? t(text) : null;
};

/** The form's state and what it can do, apart from how it is drawn. */
function createDecklistForm(props: FormProps, list: MyList) {
  const { kept, whose, mine, mutate, current } = list;
  const [profile, setProfile] = createSignal<PlayerProfile>(kept?.profile ?? emptyProfile(latestValue(session)?.user));
  const [known, setKnown] = createSignal(kept?.profile != null);
  const [deck, setDeck] = createSignal('');
  const [archetype, setArchetype] = createSignal<string | null>(null);
  const [touched, setTouched] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [registration, setRegistration] = createSignal<Registration | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const parsed = () => parseDecklist(deck());

  /** Who sent the list: the device knows them from it. */
  function fillWho(list: Decklist) {
    const { popId, firstName, lastName, birthDate } = list;
    setProfile({ popId, firstName, lastName, birthDate });
    setKnown(true);
  }
  function fill(list: Decklist) {
    setDeck(list.deck);
    setArchetype(list.archetype);
    fillWho(list);
  }
  /** Another owner's list is another player's: the form starts again from it, or from nothing. */
  function startAgain(list: Decklist | null) {
    setTouched(false);
    setRegistration(null);
    if (list) {
      fill(list);
    } else {
      setDeck('');
      setArchetype(null);
      setProfile(emptyProfile(latestValue(session)?.user));
      setKnown(false);
    }
  }
  // The list the device sent fills the form, until the player starts changing it; another owner's, once it is read.
  // One read late (a retry after a failed read) still says who sent it, under a draft begun meanwhile.
  let filledFor = untrack(whose);
  createEffect(() => {
    const existing = current();
    const owner = whose();
    if (mine.state === 'ready' && owner !== filledFor) {
      filledFor = owner;
      startAgain(existing);
    } else if (existing && !touched()) {
      fill(existing);
    } else if (existing && !untrack(known)) {
      fillWho(existing);
    }
  });

  const edit = (apply: () => void) => {
    setTouched(true);
    apply();
  };
  const fail = (err: unknown) => setError(errorText(err));

  async function send() {
    setSending(true);
    setError(null);
    const before = recall(props.code);
    const sent = profile();
    // Kept before the list goes, so a list that lands without its answer is still this device's to change.
    const token = before?.token ?? crypto.randomUUID();
    remember(props.code, { profile: sent, token });
    try {
      const result = await submitDecklist(props.code, {
        deck: deck(),
        profile: sent,
        archetype: props.archetypes ? archetype() : null,
        token
      });
      remember(props.code, { profile: sent, token: result.token });
      setRegistration(result.registration);
      setKnown(true);
      setTouched(false);
      mutate(result.decklist);
    } catch (err) {
      // The server refused the list, so nothing landed: the device keeps what it had.
      if (err instanceof ApiError && err.status < 500) {
        remember(props.code, before);
      }
      fail(err);
    } finally {
      setSending(false);
    }
  }

  function clearList() {
    setDeck('');
    setArchetype(null);
    setRegistration(null);
    mutate(null);
  }

  // The list shown is the one withdrawn, whatever the fields above it say now.
  async function withdraw(list: Decklist) {
    setError(null);
    try {
      await withdrawDecklist(props.code, list, recall(props.code)?.token ?? null);
      clearList();
    } catch (err) {
      fail(err);
    }
  }

  // The account taking the list's POP ID, its name and birth year with it; refused when another account holds it.
  const [accountSaved, setAccountSaved] = createSignal(false);
  const [clash, setClash] = createSignal(false);
  async function saveToAccount() {
    setError(null);
    setClash(false);
    try {
      const { user } = await saveProfile(profile());
      setSession(prev => (prev ? { ...prev, user } : prev));
      setAccountSaved(true);
    } catch (err) {
      fail(err);
      setClash(err instanceof ApiError && err.body?.popIdTaken === true);
    }
  }
  /** Offered to a signed-in account whose POP ID is not the sent list's yet. */
  const offerSave = () => {
    const user = latestValue(session)?.user;
    return props.sanctioned && current() !== null && Boolean(user) && user?.popId !== profile().popId;
  };

  /** Someone else on this device: forget who sent the list, and start again. */
  function notYou() {
    remember(props.code, null);
    setKnown(false);
    setProfile(emptyProfile());
    setTouched(false);
    clearList();
  }

  return {
    current,
    profile,
    known,
    deck,
    archetype,
    touched,
    sending,
    registration,
    error,
    parsed,
    needs: () => missing(profile(), deck(), props.sanctioned),
    /** Why nothing may be sent yet: a list there may be is not read, and sending would replace it unseen. */
    waiting: () => unknownText(list.state()),
    unchanged: () => current() !== null && !touched(),
    setProfile: (value: PlayerProfile) => edit(() => setProfile(value)),
    setDeck: (value: string) => edit(() => setDeck(value)),
    setArchetype: (value: string) => edit(() => setArchetype(value)),
    send,
    withdraw,
    notYou,
    offerSave,
    accountSaved,
    clash,
    saveToAccount
  };
}

type DecklistState = ReturnType<typeof createDecklistForm>;

/** Who is sending: the fields until the device knows, then the name with a way out. */
function YouRow(props: { form: DecklistState; sanctioned: boolean }) {
  const f = () => props.form;
  return (
    <div class='tm-box-bar tm-form-row'>
      <span class='tm-form-row-label'>{t('You')}</span>
      <Show
        when={f().known() && f().current()}
        fallback={
          <ProfileFields
            idPrefix='deck'
            value={f().profile()}
            sanctioned={props.sanctioned}
            errors={f().touched() ? profileProblems(f().profile(), props.sanctioned) : {}}
            onChange={value => f().setProfile(value)}
          />
        }
      >
        <span class='tm-known'>
          <strong>
            {f().profile().firstName} {f().profile().lastName}
          </strong>
          <Show when={props.sanctioned}>
            <span class='muted tm-num'>
              {' '}
              · {f().profile().popId} · {birthYearOf(f().profile().birthDate)}
            </span>
          </Show>
          <Show when={f().offerSave()}>
            <button type='button' class='btn btn-secondary tm-small' onClick={() => void f().saveToAccount()}>
              {t('Save to my account')}
            </button>
          </Show>
          <Show when={f().accountSaved() && !f().offerSave()}>
            <span class='muted' role='status'>
              {t('Saved')}
            </span>
          </Show>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => f().notYou()}>
            {t('Not you?')}
          </button>
        </span>
      </Show>
    </div>
  );
}

/** The pasted list, with its count by section and anything wrong with it. */
function ListRow(props: { form: DecklistState }) {
  const parsed = () => props.form.parsed();
  const sections = () =>
    (Object.keys(SECTION_LABELS) as DeckSection[]).map(section => ({
      section,
      count: parsed()
        .cards.filter(card => card.section === section)
        .reduce((sum, card) => sum + card.count, 0)
    }));
  return (
    <div class='tm-box-bar tm-form-row'>
      <label class='tm-form-row-label' for='deck-list'>
        {t('Decklist')}
      </label>
      <div class='tm-decklist-body'>
        <textarea
          id='deck-list'
          class='tm-input tm-textarea tm-decklist-input'
          placeholder={t('Paste your list from TCG Live')}
          value={props.form.deck()}
          onInput={e => props.form.setDeck(e.currentTarget.value)}
        />
        <Show when={props.form.deck().trim()}>
          <p class='tm-deck-counts tm-num'>
            <For each={sections()}>
              {s => (
                <span>
                  {t(SECTION_LABELS[s.section])} <strong>{s.count}</strong>
                </span>
              )}
            </For>
            <span class='tm-grow' />
            <span classList={{ 'tm-problem': parsed().total !== 60 }}>
              <strong>{parsed().total}</strong> / 60
            </span>
          </p>
          <Show
            when={parsed().problems.length > 0}
            fallback={<p class='muted tm-deck-ok'>{t('Card count and copy limits check out')}</p>}
          >
            <ul class='tm-problems'>
              <For each={parsed().problems}>{problem => <li>{problem}</li>}</For>
            </ul>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/** Submit (asking first when the list has problems), why it can't go yet, and Withdraw. */
function Foot(props: { form: DecklistState }) {
  const f = () => props.form;
  const problems = () => f().parsed().problems.length;
  const label = () => (f().current() ? t('Update decklist') : t('Submit decklist'));
  const reason = () => f().waiting() ?? f().needs() ?? (f().unchanged() ? t('No changes to send') : null);
  const held = () => f().sending() || f().unchanged() || f().waiting() !== null;
  return (
    <div class='tm-box-bar tm-decklist-foot'>
      <Show
        when={problems() > 0 && !f().needs()}
        fallback={
          <button
            type='button'
            class='btn btn-primary'
            disabled={held() || f().needs() !== null}
            onClick={() => void f().send()}
          >
            {label()}
          </button>
        }
      >
        <ConfirmAction
          class='btn btn-primary'
          label={label()}
          question={tn(problems(), 'Submit with {n} problem?', 'Submit with {n} problems?')}
          confirmLabel={t('Submit')}
          disabled={held()}
          onConfirm={() => void f().send()}
        />
      </Show>
      <Show when={reason()}>{text => <span class='muted'>{text()}</span>}</Show>
      <span class='tm-grow' />
      <Show when={f().current()}>
        {list => (
          <ConfirmAction
            class='btn btn-ghost'
            label={t('Withdraw')}
            question={t('Withdraw your decklist?')}
            confirmLabel={t('Withdraw')}
            danger
            onConfirm={() => void f().withdraw(list())}
          />
        )}
      </Show>
      <p class='tm-decklist-note muted'>
        {f().current()
          ? t('Change it from this device until submissions close.')
          : t('Staff see it. Change it until submissions close.')}
      </p>
    </div>
  );
}

/** Where the list stands: being read, unreadable (with a retry), or what the server said of it. */
function ListStatus(props: { list: MyList; known: () => string }) {
  const failed = () => props.list.state() === 'failed';
  return (
    <div class='tm-box-bar tm-decklist-status'>
      <strong role={failed() ? 'alert' : undefined}>{unknownText(props.list.state()) ?? props.known()}</strong>
      <Show when={failed()}>
        <button type='button' class='btn btn-secondary tm-small' onClick={() => props.list.retry()}>
          {t('Retry')}
        </button>
      </Show>
    </div>
  );
}

/** The list as it was sent, read-only, once players can no longer change it. */
function Receipt(props: FormProps & { list: MyList }) {
  const known = () => {
    const mine = props.list.current();
    return mine ? submittedLine(mine, null) : t('No decklist submitted');
  };
  return (
    <section class='tm-box tm-decklist-form'>
      <ListStatus list={props.list} known={known} />
      <Show when={props.list.current()}>
        {mine => (
          <div class='tm-box-bar'>
            <Show when={mine().deck} fallback={<span class='muted'>{t('Cards deleted after the event')}</span>}>
              <pre class='tm-decklist-sent'>{mine().deck}</pre>
            </Show>
          </div>
        )}
      </Show>
      <p class='tm-box-bar muted'>{props.locked ? t('Decklists locked after round 1') : t('Submission closed')}</p>
    </section>
  );
}

function OpenForm(props: FormProps & { list: MyList }) {
  // eslint-disable-next-line solid/reactivity -- the form is made once, for the list it was given
  const form = createDecklistForm(props, props.list);
  const decks = createDeckOptions(() => props.format);
  const count = () => tn(form.parsed().total, '{n} card', '{n} cards');
  return (
    <form class='tm-box tm-decklist-form' onSubmit={event => event.preventDefault()}>
      <ListStatus
        list={props.list}
        known={() => statusLine(form.current(), form.registration(), count(), form.parsed().problems.length)}
      />
      <Show when={!form.known() && props.list.state() === 'known'}>
        <p class='tm-box-bar muted'>{t('No account needed. Not registered yet? Submitting adds you.')}</p>
      </Show>
      <Show when={form.registration() === 'not-added'}>
        <p class='tm-box-bar muted'>{t('List saved. Staff will need to add you.')}</p>
      </Show>
      <YouRow form={form} sanctioned={props.sanctioned} />
      <Show when={props.archetypes}>
        {/* A wrapping label, since the picker's input takes no id. */}
        <label class='tm-box-bar tm-form-row live-deck-picker'>
          <span class='tm-form-row-label'>{t('Deck')}</span>
          <DeckCombo
            decks={decks()}
            selected={form.archetype() ? { label: form.archetype() as string } : undefined}
            placeholder={t('Search archetypes')}
            custom={SETTINGS_LIMITS.archetype}
            onPick={picked => form.setArchetype(picked.label)}
          />
        </label>
      </Show>
      <ListRow form={form} />
      <Foot form={form} />
      <Show when={form.clash()} fallback={<ErrorLine message={form.error()} />}>
        <p class='tm-error' role='alert'>
          {form.error()}
          <span class='dot' aria-hidden='true'>
            {' · '}
          </span>
          <a class='tm-link-inline' href={`${MAIN_SITE}/feedback`}>
            {t('Feedback')}
          </a>
        </p>
      </Show>
    </form>
  );
}

export function DecklistForm(props: FormProps) {
  const list = createMyList(props);
  return (
    <Show when={props.open} fallback={<Receipt {...props} list={list} />}>
      <OpenForm {...props} list={list} />
    </Show>
  );
}
