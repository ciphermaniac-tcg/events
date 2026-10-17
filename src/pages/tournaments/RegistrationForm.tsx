/**
 * Registering for an event from its page, with no account. A sanctioned
 * event asks for the Player ID first: one already registered asks its birth
 * year, which opens that registration from any device; any other goes on to
 * the name and birth year, and registers. An unsanctioned event asks for the
 * name: the player it finds (a slip in the spelling forgiven) opens on the
 * device that registered them, two who are named alike are offered to pick
 * from, and nobody found registers someone new.
 *
 * A registration hands its decklist in on paper to staff at the event, or
 * pasted here from TCG Live. The paste is read as it is typed, so a list
 * short a card says so before it is sent, and sending one with problems asks
 * first. Its menu changes the name, starts again for someone else, or
 * withdraws from the event. The device remembers whose registration it holds
 * (see decklistMemory.ts), so coming back opens it.
 */

import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { type DeckSection, parseDecklist } from '../../../shared/tournament/decklist';
import { isPopId, type PlayerProfile, profileErrors } from '../../../shared/tournament/profile';
import type { Decklist, DeckMode, NamedPlayer } from '../../../shared/tournament/view';
import {
  ApiError,
  errorText,
  lookUpRegistration,
  saveProfile,
  submitRegistration,
  withdrawRegistration
} from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { msg, t, tn } from '../../lib/i18n';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine, Field } from './Field';
import { OptionsMenu } from './OptionsMenu';
import { birthDateFor, birthYearOf, emptyProfile } from './ProfileFields';
import { session, setSession } from './session';
import { recall, remember } from './decklistMemory';

export interface RegistrationProps {
  code: string;
  sanctioned: boolean;
  /** The start as players read it, which is when changes close; null when the organizer set none. */
  closes: string | null;
  /** The event's own list is at its cap, so nobody new can register. */
  full: boolean;
  /** The registration this device or account already holds, once read; it opens straight away. */
  mine: Decklist | null;
}

type Step = 'lookup' | 'prove' | 'pick' | 'new' | 'edit' | 'withdrawn';

/** The registration's state and what it can do, apart from how it is drawn. */
function createRegistration(props: RegistrationProps) {
  // eslint-disable-next-line solid/reactivity -- the form opens on the registration the page read once
  const held = props.mine;
  const [step, setStep] = createSignal<Step>(held ? 'edit' : 'lookup');
  const [profile, setProfile] = createSignal<PlayerProfile>(
    held
      ? { popId: held.popId, firstName: held.firstName, lastName: held.lastName, birthDate: held.birthDate }
      : emptyProfile(latestValue(session)?.user)
  );
  // The names the registration is kept under, which a rename at an unsanctioned event moves it from.
  const [kept, setKept] = createSignal<NamedPlayer | null>(held);
  const [mode, setMode] = createSignal<DeckMode | null>(held?.mode ?? null);
  const [deck, setDeck] = createSignal(held?.deck ?? '');
  const [matches, setMatches] = createSignal<NamedPlayer[]>([]);
  const [naming, setNaming] = createSignal(false);
  const [saved, setSaved] = createSignal<'new' | 'edit' | null>(null);
  // Whether anything changed since the registration was opened or last saved.
  const [changed, setChanged] = createSignal(false);
  const [withdrawing, setWithdrawing] = createSignal(false);
  const [refusedFull, setRefusedFull] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const parsed = () => parseDecklist(deck());
  const token = () => recall(props.code)?.token ?? '';

  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setSaved(null);
      setChanged(true);
      set(value);
    };
  const setField = (key: keyof PlayerProfile, value: string) => {
    setSaved(null);
    setChanged(true);
    setProfile(prev => ({ ...prev, [key]: value }));
  };

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setRefusedFull(err instanceof ApiError && err.body?.full === true);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  /** A registration found: its player's names, and its list when there is one. */
  function open(found: NamedPlayer, list: Decklist | null) {
    setProfile(prev => ({ ...prev, firstName: found.firstName, lastName: found.lastName }));
    setKept(found);
    setMode(list?.mode ?? null);
    setDeck(list?.deck ?? '');
    setChanged(false);
    setStep('edit');
  }

  function startNew(names: NamedPlayer | null = null) {
    setKept(null);
    if (names) {
      setProfile(prev => ({ ...prev, ...names }));
    }
    setStep('new');
  }

  /** The Player ID, or the name, typed: what it finds decides the next step. */
  async function lookTask() {
    const found = await lookUpRegistration(props.code, profile(), { token: token() });
    if (props.sanctioned) {
      setStep(found.known ? 'prove' : 'new');
      return;
    }
    const near = found.matches ?? [];
    if (found.mine) {
      open(found.mine, found.mine);
    } else if (near.length > 1) {
      setMatches(near);
      setStep('pick');
    } else if (near[0]) {
      open(near[0], null);
    } else {
      startNew();
    }
  }
  const look = () => run(lookTask);

  /** The birth year of a registered Player ID, which opens its registration. */
  async function proveTask() {
    const year = birthYearOf(profile().birthDate);
    const found = await lookUpRegistration(props.code, profile(), { birthYear: year });
    if (found.player) {
      open(found.player, found.mine);
    }
  }
  const prove = () => run(proveTask);

  async function saveTask() {
    const before = recall(props.code);
    const sent = profile();
    const own = before?.token ?? crypto.randomUUID();
    // Kept before the list goes, so a list that lands without its answer is still this device's to change.
    remember(props.code, { profile: sent, token: own });
    try {
      const was = kept();
      const result = await submitRegistration(props.code, {
        profile: sent,
        mode: mode() ?? 'digital',
        deck: mode() === 'paper' ? '' : deck(),
        token: own,
        ...(was && !props.sanctioned ? { was } : {})
      });
      remember(props.code, { profile: sent, token: result.token });
      setSaved(step() === 'new' ? 'new' : 'edit');
      setKept({ firstName: sent.firstName, lastName: sent.lastName });
      setNaming(false);
      setChanged(false);
      setStep('edit');
    } catch (err) {
      // The server refused it, so nothing landed: the device keeps what it had.
      if (err instanceof ApiError && err.status < 500) {
        remember(props.code, before);
      }
      throw err;
    }
  }
  const save = () => run(saveTask);

  async function withdrawTask() {
    const proof = props.sanctioned ? { birthYear: birthYearOf(profile().birthDate) } : { token: token() };
    await withdrawRegistration(props.code, { ...profile(), ...(kept() ?? {}) }, proof);
    remember(props.code, null);
    setStep('withdrawn');
  }
  const withdraw = () => run(withdrawTask);

  // The account taking the registration's Player ID, with its name and birth year; refused when another account holds it.
  const [accountSaved, setAccountSaved] = createSignal(false);
  async function saveToAccountTask() {
    const { user } = await saveProfile(profile());
    setSession(prev => (prev ? { ...prev, user } : prev));
    setAccountSaved(true);
  }
  const saveToAccount = () => run(saveToAccountTask);
  /** Offered to a signed-in account whose Player ID is not this registration's yet: a list may be sent for a friend. */
  const offerSave = () => {
    const user = latestValue(session)?.user;
    return props.sanctioned && step() === 'edit' && Boolean(user) && user?.popId !== profile().popId;
  };

  /** Someone else on this device: forget whose registration it held, and start again. */
  function notYou() {
    remember(props.code, null);
    setProfile(emptyProfile());
    setKept(null);
    setMode(null);
    setDeck('');
    setSaved(null);
    setError(null);
    setNaming(false);
    setWithdrawing(false);
    setStep('lookup');
  }

  return {
    step,
    profile,
    setField,
    mode,
    setMode: edit(setMode),
    deck,
    setDeck: edit(setDeck),
    parsed,
    matches,
    naming,
    setNaming,
    withdrawing,
    setWithdrawing,
    saved,
    changed,
    busy,
    error,
    full: () => step() === 'new' && (props.full || refusedFull()),
    look,
    prove,
    pick: (player: NamedPlayer | null) => (player ? open(player, null) : startNew(profile())),
    save,
    withdraw,
    notYou,
    offerSave,
    accountSaved,
    saveToAccount
  };
}

type Registration = ReturnType<typeof createRegistration>;

/** What is still missing before the registration can go, for the line under a held-back button. */
function missing(form: Registration, sanctioned: boolean): string | null {
  const problems = profileErrors(form.profile(), sanctioned);
  if (problems.firstName || problems.lastName || problems.popId || problems.birthDate) {
    return sanctioned ? t('Fill in your Player ID, name and birth year') : t('Fill in your name');
  }
  return form.mode() === 'digital' && !form.deck().trim() ? t('Paste a decklist') : null;
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  numeric?: boolean;
  autocomplete?: string;
  onInput: (value: string) => void;
  onEnter?: () => void;
}) {
  return (
    <Field id={props.id} label={props.label}>
      <input
        id={props.id}
        class='tm-input tm-reg-input'
        value={props.value}
        inputMode={props.numeric ? 'numeric' : undefined}
        maxLength={props.numeric ? 10 : 40}
        autocomplete={props.autocomplete ?? 'off'}
        autocapitalize={props.numeric ? undefined : 'words'}
        onInput={e => props.onInput(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && props.onEnter) {
            e.preventDefault();
            props.onEnter();
          }
        }}
      />
    </Field>
  );
}

function NameFields(props: { form: Registration }) {
  const f = () => props.form;
  return (
    <div class='tm-reg-two'>
      <TextField
        id='reg-first'
        label={t('First name')}
        value={f().profile().firstName}
        autocomplete='given-name'
        onInput={value => f().setField('firstName', value)}
      />
      <TextField
        id='reg-last'
        label={t('Last name')}
        value={f().profile().lastName}
        autocomplete='family-name'
        onInput={value => f().setField('lastName', value)}
      />
    </div>
  );
}

function YearField(props: { form: Registration; onEnter?: () => void }) {
  return (
    <TextField
      id='reg-year'
      label={t('Birth year')}
      value={birthYearOf(props.form.profile().birthDate)}
      numeric
      onInput={value => props.form.setField('birthDate', birthDateFor(value))}
      onEnter={props.onEnter}
    />
  );
}

/** Step one: the Player ID, or at an unsanctioned event the name, and Continue. */
function Lookup(props: { form: Registration; sanctioned: boolean }) {
  const f = () => props.form;
  const ready = () =>
    props.sanctioned
      ? isPopId(f().profile().popId.trim())
      : Boolean(f().profile().firstName.trim() && f().profile().lastName.trim());
  const go = () => {
    if (ready() && !f().busy()) {
      void f().look();
    }
  };
  return (
    <section class='tm-box tm-reg'>
      <div class='tm-box-bar tm-reg-stack'>
        <Show when={props.sanctioned} fallback={<NameFields form={f()} />}>
          <TextField
            id='reg-pop'
            label={t('Player ID')}
            value={f().profile().popId}
            numeric
            onInput={value => f().setField('popId', value.trim())}
            onEnter={go}
          />
          <Show when={f().profile().popId.trim() && !isPopId(f().profile().popId.trim())}>
            <p class='tm-reg-note tm-problem'>{t('Player IDs are numbers only.')}</p>
          </Show>
        </Show>
        <button type='button' class='btn btn-primary tm-reg-wide' disabled={!ready() || f().busy()} onClick={go}>
          {t('Continue')}
        </button>
        <ErrorLine message={f().error()} />
      </div>
    </section>
  );
}

/** Who the registration is, with the menu that changes the name, starts again or withdraws. */
function Head(props: { form: Registration; sanctioned: boolean; title: string; menu: boolean }) {
  const f = () => props.form;
  return (
    <div class='tm-box-bar tm-reg-head'>
      <span class='tm-reg-who'>
        <strong>{props.title}</strong>
        <Show when={props.sanctioned && f().profile().popId}>
          <span class='muted tm-num'>{f().profile().popId}</span>
        </Show>
      </span>
      <Show
        when={props.menu}
        fallback={
          <button type='button' class='btn btn-ghost tm-small' onClick={() => f().notYou()}>
            {t('Not you?')}
          </button>
        }
      >
        <OptionsMenu name={props.title} buttonLabel={t('More')} closeOnSelect>
          <button type='button' class='tm-menu-item' onClick={() => f().setNaming(true)}>
            {t('Change name')}
          </button>
          <button type='button' class='tm-menu-item' onClick={() => f().notYou()}>
            {t('Not you?')}
          </button>
          <button type='button' class='tm-menu-item tm-danger' onClick={() => f().setWithdrawing(true)}>
            {t('Withdraw')}
          </button>
        </OptionsMenu>
      </Show>
    </div>
  );
}

/** A registered Player ID: its birth year opens the registration. */
function Prove(props: { form: Registration }) {
  const f = () => props.form;
  const ready = () => /^\d{4}$/.test(birthYearOf(f().profile().birthDate)) && !f().busy();
  const go = () => {
    if (ready()) {
      void f().prove();
    }
  };
  return (
    <section class='tm-box tm-reg'>
      <Head form={f()} sanctioned={false} title={f().profile().popId} menu={false} />
      <div class='tm-box-bar tm-reg-stack'>
        <YearField form={f()} onEnter={go} />
        <p class='tm-reg-note'>{t('Enter your birth year to make changes.')}</p>
        <button type='button' class='btn btn-primary tm-reg-wide' disabled={!ready()} onClick={go}>
          {t('Continue')}
        </button>
        <ErrorLine message={f().error()} />
      </div>
    </section>
  );
}

/** Two players named like the name typed: which one, or neither. */
function Pick(props: { form: Registration }) {
  const f = () => props.form;
  return (
    <section class='tm-box tm-reg'>
      <div class='tm-box-bar tm-reg-stack'>
        <p class='tm-reg-note'>{t('Which one are you?')}</p>
        <For each={f().matches()}>
          {player => (
            <button type='button' class='btn btn-secondary tm-reg-wide' onClick={() => f().pick(player)}>
              {player.firstName} {player.lastName}
            </button>
          )}
        </For>
        <button type='button' class='btn btn-ghost' onClick={() => f().pick(null)}>
          {t('None of these')}
        </button>
      </div>
    </section>
  );
}

const SECTION_LABELS: Record<DeckSection, string> = {
  pokemon: msg('Pokémon'),
  trainer: msg('Trainer'),
  energy: msg('Energy')
};

/** The pasted list, with its count by section and anything wrong with it. */
function Paste(props: { form: Registration }) {
  const parsed = () => props.form.parsed();
  const sections = () =>
    (Object.keys(SECTION_LABELS) as DeckSection[]).map(section => ({
      section,
      count: parsed()
        .cards.filter(card => card.section === section)
        .reduce((sum, card) => sum + card.count, 0)
    }));
  return (
    <div class='tm-decklist-body'>
      <textarea
        class='tm-input tm-textarea tm-decklist-input'
        aria-label={t('Decklist')}
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
          <span classList={{ 'tm-problem': parsed().total !== 60 }}>{t('{n} / 60 cards', { n: parsed().total })}</span>
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
  );
}

function ModeOption(props: { form: Registration; value: DeckMode; label: string; detail: string }) {
  return (
    <label class='tm-reg-option' classList={{ 'is-on': props.form.mode() === props.value }}>
      <input
        type='radio'
        name='reg-mode'
        checked={props.form.mode() === props.value}
        onChange={() => props.form.setMode(props.value)}
      />
      <span>
        <strong>{props.label}</strong>
        <span class='muted'>{props.detail}</span>
      </span>
    </label>
  );
}

/** In person or digital, and the paste box for a digital list. */
function DeckChoice(props: { form: Registration; closes: string | null }) {
  const f = () => props.form;
  return (
    <div class='tm-box-bar tm-reg-stack'>
      <fieldset class='tm-reg-options'>
        <legend class='tm-label'>{t('Decklist')}</legend>
        <ModeOption form={f()} value='paper' label={t('In person')} detail={t('Hand a paper decklist to staff')} />
        <ModeOption form={f()} value='digital' label={t('Digital')} detail={t('Paste your list from TCG Live')} />
      </fieldset>
      <Show when={f().mode() === 'paper'}>
        <p class='tm-reg-note'>{t('Hand your paper decklist to staff at check-in.')}</p>
      </Show>
      <Show when={f().mode() === 'digital'}>
        <Paste form={f()} />
      </Show>
      <Show when={f().mode() && props.closes}>
        {closes => <p class='tm-reg-note'>{t('Changes close at {start}.', { start: closes() })}</p>}
      </Show>
    </div>
  );
}

/** Register or Save changes (asking first when the list has problems), or why it cannot go yet. */
function Foot(props: { form: Registration; sanctioned: boolean; label: string; children?: JSX.Element }) {
  const f = () => props.form;
  const problems = () => (f().mode() === 'digital' ? f().parsed().problems.length : 0);
  const unchanged = () => f().step() === 'edit' && !f().changed();
  const needs = () => missing(f(), props.sanctioned) ?? (unchanged() && !f().saved() ? t('No changes to send') : null);
  const held = () => f().busy() || f().mode() === null || unchanged() || needs() !== null;
  return (
    <div class='tm-box-bar tm-decklist-foot'>
      <Show
        when={problems() > 0 && !needs()}
        fallback={
          <button type='button' class='btn btn-primary' disabled={held()} onClick={() => void f().save()}>
            {props.label}
          </button>
        }
      >
        <ConfirmAction
          class='btn btn-primary'
          label={props.label}
          question={tn(problems(), 'Submit with {n} problem?', 'Submit with {n} problems?')}
          confirmLabel={props.label}
          disabled={held()}
          onConfirm={() => void f().save()}
        />
      </Show>
      <Show when={needs()}>{text => <span class='muted'>{text()}</span>}</Show>
      {props.children}
      <Show when={!f().full()}>
        <ErrorLine message={f().error()} />
      </Show>
    </div>
  );
}

function NewRegistration(props: { form: Registration; reg: RegistrationProps }) {
  const f = () => props.form;
  return (
    <section class='tm-box tm-reg'>
      <Head form={f()} sanctioned={props.reg.sanctioned} title={t('New registration')} menu={false} />
      <Show
        when={!f().full()}
        fallback={
          <div class='tm-box-bar tm-reg-stack'>
            <strong>{t('This event is full.')}</strong>
            <p class='tm-reg-note'>{t('A spot opens if someone withdraws.')}</p>
          </div>
        }
      >
        <div class='tm-box-bar tm-reg-stack'>
          <NameFields form={f()} />
          <Show when={props.reg.sanctioned}>
            <YearField form={f()} />
          </Show>
        </div>
        <DeckChoice form={f()} closes={props.reg.closes} />
        <Foot form={f()} sanctioned={props.reg.sanctioned} label={t('Register')} />
      </Show>
    </section>
  );
}

function EditRegistration(props: { form: Registration; reg: RegistrationProps }) {
  const f = () => props.form;
  const name = () => `${f().profile().firstName} ${f().profile().lastName}`;
  return (
    <section class='tm-box tm-reg'>
      <Head form={f()} sanctioned={props.reg.sanctioned} title={name()} menu />
      <Show when={f().withdrawing()}>
        <div class='tm-box-bar tm-row-actions tm-confirm' role='group' aria-label={t('Withdraw')}>
          <span>{t('Withdraw from this event?')}</span>
          <button
            type='button'
            class='btn btn-secondary tm-small tm-danger'
            disabled={f().busy()}
            onClick={() => void f().withdraw()}
          >
            {t('Withdraw')}
          </button>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => f().setWithdrawing(false)}>
            {t('Keep my spot')}
          </button>
        </div>
      </Show>
      <Show when={f().naming()}>
        <div class='tm-box-bar tm-reg-stack'>
          <NameFields form={f()} />
        </div>
      </Show>
      <DeckChoice form={f()} closes={props.reg.closes} />
      <Foot form={f()} sanctioned={props.reg.sanctioned} label={t('Save changes')}>
        <Show when={f().saved()}>
          {saved => (
            <span class='tm-reg-done'>{saved() === 'new' ? t('You’re registered.') : t('Changes saved.')}</span>
          )}
        </Show>
        <Show when={f().offerSave() || f().accountSaved()}>
          <span class='tm-grow' />
          <Show when={!f().accountSaved()} fallback={<span class='muted'>{t('Saved')}</span>}>
            <button type='button' class='btn btn-ghost tm-small' onClick={() => void f().saveToAccount()}>
              {t('Save to my account')}
            </button>
          </Show>
        </Show>
      </Foot>
    </section>
  );
}

function Withdrawn(props: { form: Registration; closes: string | null }) {
  return (
    <section class='tm-box tm-reg'>
      <div class='tm-box-bar tm-reg-stack'>
        <strong>{t('You’ve withdrawn.')}</strong>
        <Show when={props.closes}>
          {closes => <p class='tm-reg-note'>{t('You can register again until {start}.', { start: closes() })}</p>}
        </Show>
        <button type='button' class='btn btn-secondary' onClick={() => props.form.notYou()}>
          {t('Done')}
        </button>
      </div>
    </section>
  );
}

export function RegistrationForm(props: RegistrationProps) {
  const form = createRegistration(props);
  return (
    <Switch>
      <Match when={form.step() === 'lookup'}>
        <Lookup form={form} sanctioned={props.sanctioned} />
      </Match>
      <Match when={form.step() === 'prove'}>
        <Prove form={form} />
      </Match>
      <Match when={form.step() === 'pick'}>
        <Pick form={form} />
      </Match>
      <Match when={form.step() === 'new'}>
        <NewRegistration form={form} reg={props} />
      </Match>
      <Match when={form.step() === 'edit'}>
        <EditRegistration form={form} reg={props} />
      </Match>
      <Match when={form.step() === 'withdrawn'}>
        <Withdrawn form={form} closes={props.closes} />
      </Match>
    </Switch>
  );
}
