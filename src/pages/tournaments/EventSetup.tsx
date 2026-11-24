/**
 * Setting up a new event on one screen: a heading and the name, then one box
 * of what players need first: its kind and whether it is sanctioned, the
 * format, the start, where it is played and the entry fee. Everything else
 * starts at its default and is changed in the console's Settings, whose
 * controls these are, so a setting looks the same in both places. An event
 * followed from TOM asks only what its .tdf does not say (the name,
 * sanctioning, divisions and round length all come from the file). An account that may run
 * events more than one way picks who runs this one first: one of its stores,
 * or itself, whose events are never sanctioned and so ask nothing about it.
 * A store's Swiss event can start from one of its pokemon.com listings (see
 * ListingPicker), which fills in the name, start, kind and sanction ID, so
 * whether it is sanctioned and its kind are not asked. A store's event is
 * played at the store, whose name and address the server gives it.
 */

import { createSignal, For, type JSX, Show, untrack } from 'solid-js';
import type { Listing } from '../../../shared/accounts/types';
import { DEFAULT_ROUND_MINUTES, eventTimeLimits } from '../../../shared/tournament/create';
import { CREATIONS_PER_DAY, eventDay } from '../../../shared/tournament/limits';
import { t } from '../../lib/i18n';
import { createMedia, NOT_TOM_DESKTOP } from '../../lib/media';
import { setupDraft } from '../../lib/tournament/setupDraft';
import { SANCTIONED } from '../../../shared/tournament/structure';
import { EVENT_TYPES, type EventType } from '../../../shared/tournament/types';
import type { DecklistMode, DeckVisibility, TournamentSettings } from '../../../shared/tournament/view';
import { LISTING_KINDS, listingFill, shortDay } from '../../lib/tournament/stores';
import { ErrorLine } from './Field';
import { FormatSelect } from './FormatSelect';
import { ListingPicker } from './ListingPicker';
import { browserZone, FeeField, PlaceRows } from './LogisticsRows';
import { ALWAYS_SANCTIONED, EventTypeSelect } from './SettingChoices';
import { SettingRow, Toggle } from './SettingControls';
import { SETTING_INFO, SettingInfo } from './SettingInfo';

export interface Setup {
  name: string;
  roundTime: number;
  eventType: EventType;
  settings: Partial<TournamentSettings>;
  /** The store that runs it; null for the account's own. */
  store: string | null;
  /** The organizer's own date, YYYY-MM-DD, for an event set to no start time. */
  today: string;
  /** The pokemon.com listing it was started from, by its sanction ID; left out for none. */
  sanctionId?: string;
}

/** Who may run the new event: a store by its id, or the account itself (null). */
export interface RunAs {
  id: string | null;
  label: string;
  /** Whether it runs sanctioned events: a store with its league does; the account itself and an unsanctioned store do not. */
  sanctions: boolean;
  /** The store's time zone, which its events start in; the account's own start in the browser's. */
  timeZone?: string;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRunAs = (value: unknown): value is string | null => value === null || isString(value);
const isListing = (value: unknown): value is Listing | null => {
  if (value === null) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const listing = value as Record<string, unknown>;
  return (
    ['sanctionId', 'name', 'date', 'time'].every(key => isString(listing[key])) &&
    Object.hasOwn(LISTING_KINDS, String(listing.kind))
  );
};

/**
 * The round length to create the event with: the one Run again brought, kept
 * within what its kind allows, and at least a sanctioned round's.
 */
function roundMinutes(minutes: number, type: EventType, sanctioned: boolean): number {
  const { minimum, maximum } = eventTimeLimits(type);
  const floor = sanctioned ? Math.max(SANCTIONED.minutes, minimum) : minimum;
  return Math.min(maximum, Math.max(floor, Math.round(minutes) || DEFAULT_ROUND_MINUTES));
}

/** The browser's own date, YYYY-MM-DD. */
const localToday = () => new Date().toLocaleDateString('en-CA');

export function EventSetup(props: {
  /** 'tom' when the event comes from a .tdf, whose own answers are not asked again. */
  mode: 'swiss' | 'tom';
  /** The name the .tdf gave, shown instead of asked. */
  tdfName?: string;
  /** Whether the imported event has a Play! Pokémon sanction ID. */
  tdfSanctioned?: boolean;
  /** Who may run it, the first chosen to start with unless `initialRunAs` names another; one choice asks nothing. */
  runAs: readonly RunAs[];
  initialRunAs?: string | null;
  draftKey: string;
  /** The event Run again took these answers from, named under the heading so a one-off setting is seen. */
  from?: string | undefined;
  community: boolean;
  communityDays: readonly string[];
  busy: boolean;
  error: string | null;
  onCreate: (setup: Setup) => void;
  onCancel: () => void;
  /** Picking the .tdf of a sanctioned event TOM pairs, run by `store`, which sets it up from the file instead. */
  tdfLink?: (store: string | null) => JSX.Element;
  /** Back to a sanctioned event Ciphermaniac pairs, from setting up one TOM pairs. */
  onPairHere?: () => void;
}) {
  const field = untrack(() => setupDraft(props.draftKey));
  const [name, setName] = field('name', '', isString);
  const [sanctionedChoice, setSanctioned] = field('sanctioned', false, isBoolean);
  const [playToolsConfirmed, setPlayToolsConfirmed] = field('playToolsConfirmed', false, isBoolean);
  const [format, setFormat] = field('format', 'Standard', isString);
  const [startsAt, setStartsAt] = field('startsAt', '', isString);
  const [entryFee, setEntryFee] = field('entryFee', 0, isNumber);
  // '' follows who runs the event; Run again brings the zone of the event it repeats.
  const [zone] = field('timeZone', '', isString);
  const [venue, setVenue] = field('venue', '', isString);
  const [address, setAddress] = field('address', '', isString);
  // Not asked here: Run again brings these, and Settings changes them.
  const [roundTime] = field('roundTime', String(DEFAULT_ROUND_MINUTES), isString);
  const [reporting] = field('reporting', false, isBoolean);
  const [archetypes] = field<DeckVisibility>('archetypes', 'off', (value): value is DeckVisibility =>
    ['off', 'always', 'after'].includes(String(value))
  );
  const [decklists] = field<DecklistMode>('decklists', 'off', (value): value is DecklistMode =>
    ['off', 'open', 'closed'].includes(String(value))
  );
  const [roundCap] = field('roundCap', 0, isNumber);
  const [eventType, setEventType] = field<EventType>('eventType', 'cup', (value): value is EventType =>
    EVENT_TYPES.includes(value as EventType)
  );
  const initial = untrack(() => props.initialRunAs ?? props.runAs[0]?.id ?? null);
  const [savedRunAs, setRunAs] = field<string | null>('runAs', initial, isRunAs);
  const runAs = () => (props.runAs.some(option => option.id === savedRunAs()) ? savedRunAs() : initial);
  const [listing, setListing] = field<Listing | null>('listing', null, isListing);
  untrack(() => {
    if (props.initialRunAs && props.initialRunAs !== savedRunAs()) {
      setRunAs(initial);
      setListing(null);
    }
  });
  const swiss = () => props.mode === 'swiss';
  // Not kept in the draft: going back from a TOM event's setup comes back to pairing here.
  const [tomChosen, setTomChosen] = createSignal(false);
  /** TOM runs on a computer: a narrow or touch screen has no way to link its file, so it is not asked. */
  const notTomDesktop = createMedia(NOT_TOM_DESKTOP);
  /** Run by a store, which is where it is played. */
  const atStore = () => runAs() !== null;
  /** Run under the account's own name or an unsanctioned store's: never sanctioned. */
  const own = () => !props.runAs.find(option => option.id === runAs())?.sanctions;
  const selectedEventType = () => (own() && !['local', 'prerelease'].includes(eventType()) ? 'local' : eventType());
  /** A League Cup or Challenge always is; a Local or Prerelease when the organizer says. */
  const sanctioned = () => !own() && (ALWAYS_SANCTIONED.includes(selectedEventType()) || sanctionedChoice());
  /** A sanctioned event TOM pairs: it starts from TOM's file, which answers the rest. */
  const tomOffered = () => swiss() && sanctioned() && props.tdfLink !== undefined && !notTomDesktop();
  const tomPairs = () => tomOffered() && tomChosen();
  const asksPairing = () => (swiss() ? tomOffered() : props.onPairHere !== undefined);
  /** A TOM event's own setup always says TOM; a Swiss one, what was picked. */
  const pairsInTom = () => !swiss() || tomPairs();
  /** In a TOM event's setup, Ciphermaniac goes back to setting up one paired here. */
  function choosePairing(tom: boolean) {
    if (swiss()) {
      setTomChosen(tom);
    } else if (!tom) {
      props.onPairHere?.();
    }
  }
  /** The listing it starts from, which says whether it is sanctioned and its kind; none run as the account's own. */
  const listed = () => (own() ? null : listing());
  const needsName = () => swiss() && !name().trim();
  const needsPlayTools = () => (swiss() ? sanctioned() : props.tdfSanctioned);
  const limited = () => props.community && runAs() === null;
  const day = () => eventDay(startsAt(), localToday());
  const dayTaken = () => limited() && props.communityDays.includes(day());
  const cannotCreate = () =>
    [props.busy, needsName(), dayTaken(), needsPlayTools() && !playToolsConfirmed()].some(Boolean);
  // A name or the Play! Tools box left empty is the browser's to point at, so Create waits only on the rest.
  const held = () => props.busy || dayTaken();

  /** A listing fills what it says; Not listed here leaves what was typed and drops only the sanction ID. */
  function pick(next: Listing | null) {
    setListing(next);
    if (!next) {
      return;
    }
    const fill = listingFill(next);
    setName(fill.name);
    setStartsAt(fill.startsAt);
    setEventType(fill.eventType);
    setSanctioned(fill.sanctioned);
    // Listed on pokemon.com is what being created in Play! Tools leads to.
    setPlayToolsConfirmed(fill.sanctioned);
  }
  function chooseRunAs(id: string | null) {
    setRunAs(id);
    setListing(null);
  }
  /** Where it is played and the zone its times are in: a store's event is at the store, in its zone. */
  const logistics = () => ({
    timeZone: zone() || (props.runAs.find(option => option.id === runAs())?.timeZone ?? browserZone()),
    venue: atStore() ? '' : venue(),
    address: atStore() ? '' : address()
  });
  /** A sanctioned event plays at least three rounds, so a lower cap goes back to the recommendation. */
  const cap = () => (sanctioned() && roundCap() < SANCTIONED.swissRounds ? 0 : roundCap());

  function submit(event: Event) {
    event.preventDefault();
    if (cannotCreate()) {
      return;
    }
    const from = listed();
    props.onCreate({
      name: name().trim(),
      roundTime: roundMinutes(Number(roundTime()), selectedEventType(), sanctioned()),
      eventType: selectedEventType(),
      store: runAs(),
      today: localToday(),
      ...(from ? { sanctionId: from.sanctionId } : {}),
      settings: {
        format: format(),
        startsAt: startsAt(),
        ...logistics(),
        entryFee: entryFee(),
        deckVisibility: archetypes(),
        decklists: decklists(),
        playerReporting: reporting(),
        ...(swiss() ? { sanctioned: sanctioned(), roundCap: cap() } : {})
      }
    });
  }

  return (
    <form class='tm-setup' onSubmit={submit}>
      <div class='tm-setup-head'>
        <h2>{t('New event')}</h2>
        <Show when={props.from}>{from => <p class='muted'>{t('From {event}', { event: from() })}</p>}</Show>
      </div>
      <SetupName swiss={swiss() && !tomPairs()} name={name()} tdfName={props.tdfName} onInput={setName} />
      <Show when={props.runAs.length > 1}>
        <div class='tm-box'>
          <SettingRow label={t('Run as')} for='setup-run-as'>
            <select
              id='setup-run-as'
              class='tm-input'
              value={runAs() ?? ''}
              onChange={e => chooseRunAs(e.currentTarget.value || null)}
            >
              <For each={props.runAs}>{option => <option value={option.id ?? ''}>{option.label}</option>}</For>
            </select>
          </SettingRow>
        </div>
      </Show>
      <Show when={swiss() && !own() && !tomPairs() && runAs()}>
        {store => <ListingPicker storeId={store()} picked={listing()?.sanctionId ?? ''} onPick={pick} />}
      </Show>
      <div class='tm-box'>
        <Show when={!tomPairs() && listing()}>{picked => <ListingRow listing={picked()} />}</Show>
        <Show when={swiss() && !listed()}>
          <SettingRow label={t('Event type')}>
            <EventTypeSelect
              value={selectedEventType()}
              types={own() ? ['local', 'prerelease'] : undefined}
              sanctioned={own() ? undefined : sanctionedChoice()}
              onChange={setEventType}
              onSanctioned={setSanctioned}
            />
          </SettingRow>
        </Show>
        <Show when={asksPairing()}>
          <PairingRow tom={pairsInTom()} onChange={choosePairing} />
        </Show>
        <Show when={!tomPairs()}>
          <Show when={needsPlayTools()}>
            <PlayToolsRow confirmed={playToolsConfirmed()} onConfirm={setPlayToolsConfirmed} />
          </Show>
          <SettingRow label={t('Format')} for='setup-format'>
            <FormatSelect id='setup-format' value={format()} onChange={setFormat} />
          </SettingRow>
          <SettingRow label={t('Starts')} for='setup-starts'>
            <input
              id='setup-starts'
              class='tm-input'
              type='datetime-local'
              value={startsAt()}
              onInput={e => setStartsAt(e.currentTarget.value)}
            />
          </SettingRow>
          <Show when={!atStore()}>
            <PlaceRows
              id='setup'
              venue={venue()}
              address={address()}
              onChange={(key, value) => (key === 'venue' ? setVenue(value) : setAddress(value))}
            />
          </Show>
          <SettingRow label={t('Entry fee')} for='setup-fee'>
            <FeeField id='setup-fee' country='' value={entryFee()} onChange={setEntryFee} />
          </SettingRow>
        </Show>
      </div>
      <Show
        when={tomPairs()}
        fallback={
          <SetupFooter
            limited={limited()}
            dayTaken={dayTaken()}
            day={day()}
            unconfirmed={needsPlayTools() === true && !playToolsConfirmed()}
            cannotCreate={held()}
            onCancel={props.onCancel}
          />
        }
      >
        <TdfFooter link={props.tdfLink?.(runAs())} onCancel={props.onCancel} />
      </Show>
      <ErrorLine message={props.error} />
    </form>
  );
}

/** The pokemon.com listing the event starts from, by its sanction ID and kind. */
function ListingRow(props: { listing: Listing }) {
  return (
    <SettingRow label={t('Sanction ID')}>
      <span class='tm-set-inline'>
        <span class='tm-num'>{props.listing.sanctionId}</span>
        <span class='muted'>{t(LISTING_KINDS[props.listing.kind])}</span>
      </span>
    </SettingRow>
  );
}

/** An event TOM pairs is made from its file, so the way on is picking it. */
function TdfFooter(props: { link: JSX.Element; onCancel: () => void }) {
  return (
    <div class='tm-setup-foot'>
      {props.link}
      <button type='button' class='btn btn-ghost' onClick={() => props.onCancel()}>
        {t('Cancel')}
      </button>
    </div>
  );
}

/**
 * Whether TOM or Ciphermaniac pairs a sanctioned event and keeps its results,
 * asked only on a desktop, where TOM runs. It cannot change once the event is
 * made: a TOM event follows TOM's file, and one paired here only writes a
 * .tdf at the end.
 */
function PairingRow(props: { tom: boolean; onChange: (tom: boolean) => void }) {
  return (
    <SettingRow label={t('Pairing and results')} info={<SettingInfo text={SETTING_INFO.pairing} />}>
      <Toggle
        label={t('Pairing and results')}
        value={props.tom}
        on={t('TOM')}
        off={t('Ciphermaniac')}
        onChange={props.onChange}
      />
    </SettingRow>
  );
}

/** Where a sanctioned event is created first, and the organizer's word that they have. */
function PlayToolsRow(props: { confirmed: boolean; onConfirm: (value: boolean) => void }) {
  return (
    <SettingRow label={t('Play! Tools')}>
      <div class='tm-field'>
        <div class='tm-set-inline'>
          <a href='https://play-tools.pokemon.com/' target='_blank' rel='noopener noreferrer'>
            Play! Tools
          </a>
          <a href='https://play-tools.pokemon.com/guide' target='_blank' rel='noopener noreferrer'>
            {t('Sanctioning guide')}
          </a>
        </div>
        <label class='tm-check'>
          <input
            type='checkbox'
            required
            checked={props.confirmed}
            onChange={e => props.onConfirm(e.currentTarget.checked)}
          />
          {t('I’ve created this event in Play! Tools')}
        </label>
      </div>
    </SettingRow>
  );
}

function SetupFooter(props: {
  limited: boolean;
  dayTaken: boolean;
  day: string;
  /** A sanctioned event not yet confirmed as created in Play! Tools. */
  unconfirmed: boolean;
  cannotCreate: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      <Show when={props.limited}>
        <p class='muted' role='status'>
          {t('One community event per date · up to {count} creations in 24 hours.', {
            count: CREATIONS_PER_DAY.community
          })}
          <Show when={props.dayTaken}> {t('An event already uses {day}.', { day: shortDay(props.day) })}</Show>
        </p>
      </Show>
      <div class='tm-setup-foot'>
        {/* An empty name is pointed at by the browser when Create is pressed; this is the one reason it can't say. */}
        <Show when={props.unconfirmed}>
          <span class='muted'>{t('Confirm the event is in Play! Tools to create it')}</span>
        </Show>
        <button type='submit' class='btn btn-primary' disabled={props.cannotCreate}>
          {t('Create event')}
        </button>
        <button type='button' class='btn btn-ghost' onClick={() => props.onCancel()}>
          {t('Cancel')}
        </button>
      </div>
    </>
  );
}

function SetupName(props: { swiss: boolean; name: string; tdfName?: string; onInput: (value: string) => void }) {
  return (
    <div class='tm-box'>
      <SettingRow label={t('Event name')} for='setup-name'>
        <Show
          when={props.swiss}
          fallback={
            <p class='tm-setup-file'>
              <Show when={props.tdfName} fallback={<span class='muted'>{t('From the .tdf')}</span>}>
                {tdfName => <strong>{tdfName()}</strong>}
              </Show>
            </p>
          }
        >
          <input
            id='setup-name'
            class='tm-input tm-setup-name'
            maxLength={120}
            placeholder={t('Event name')}
            aria-label={t('Event name')}
            required
            value={props.name}
            ref={el => {
              // Not on a phone, where focus would open the keyboard over the form.
              if (!matchMedia('(max-width: 640px)').matches) {
                queueMicrotask(() => el.focus());
              }
            }}
            onInput={e => props.onInput(e.currentTarget.value)}
          />
        </Show>
      </SettingRow>
    </div>
  );
}
