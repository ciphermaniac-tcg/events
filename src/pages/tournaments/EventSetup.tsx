/**
 * Setting up a new event on one screen: a heading and the name, then one box
 * of settings rows with every other answer at its default, changed in place.
 * A Swiss event asks everything; an event followed from TOM asks only what
 * its .tdf does not say (the name, sanctioning, divisions and round length all
 * come from the file). The controls are the ones the console's Event tab
 * uses, so a setting looks the same in both places. An account that may run
 * events more than one way picks who runs this one first: one of its stores,
 * or itself, whose events are never sanctioned and so ask nothing about it.
 * A store's Swiss event can start from one of its pokemon.com listings (see
 * ListingPicker), which fills in the name, start, kind and sanction ID.
 */

import { For, Show, untrack } from 'solid-js';
import type { Listing } from '../../../shared/accounts/types';
import { DEFAULT_ROUND_MINUTES, eventTimeLimits } from '../../../shared/tournament/create';
import { CREATIONS_PER_DAY, eventDay, isRoundMinutes } from '../../../shared/tournament/limits';
import { setupDraft } from '../../lib/tournament/setupDraft';
import { SANCTIONED } from '../../../shared/tournament/structure';
import { EVENT_TYPES, type EventType } from '../../../shared/tournament/types';
import type { DecklistMode, DeckVisibility, TournamentSettings } from '../../../shared/tournament/view';
import { LISTING_KINDS, listingFill } from '../../lib/tournament/stores';
import { ErrorLine } from './Field';
import { FormatSelect } from './FormatSelect';
import { ListingPicker } from './ListingPicker';
import { browserZone, type Logistics, LogisticsRows } from './LogisticsRows';
import { DecklistsSwitch, EventTypeSwitch, RoundsSelect } from './SettingChoices';
import { ArchetypesSelect, SettingRow, Toggle } from './SettingControls';
import { reportingInfo, SETTING_INFO, SettingInfo } from './SettingInfo';

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
  community: boolean;
  communityDays: readonly string[];
  busy: boolean;
  error: string | null;
  onCreate: (setup: Setup) => void;
  onCancel: () => void;
}) {
  const field = untrack(() => setupDraft(props.draftKey));
  const [name, setName] = field('name', '', isString);
  const [sanctionedChoice, setSanctioned] = field('sanctioned', false, isBoolean);
  const [playToolsConfirmed, setPlayToolsConfirmed] = field('playToolsConfirmed', false, isBoolean);
  const [format, setFormat] = field('format', 'Standard', isString);
  const [startsAt, setStartsAt] = field('startsAt', '', isString);
  const [checkInAt, setCheckInAt] = field('checkInAt', '', isString);
  // '' follows who runs the event until the organizer picks a zone.
  const [zone, setZone] = field('timeZone', '', isString);
  const [venue, setVenue] = field('venue', '', isString);
  const [address, setAddress] = field('address', '', isString);
  const [roundTime, setRoundTime] = field('roundTime', String(DEFAULT_ROUND_MINUTES), isString);
  const [reporting, setReporting] = field('reporting', false, isBoolean);
  const [archetypes, setArchetypes] = field<DeckVisibility>('archetypes', 'off', (value): value is DeckVisibility =>
    ['off', 'always', 'after'].includes(String(value))
  );
  const [decklists, setDecklists] = field<DecklistMode>('decklists', 'off', (value): value is DecklistMode =>
    ['off', 'open', 'closed'].includes(String(value))
  );
  const [roundCap, setRoundCap] = field('roundCap', 0, isNumber);
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
  const logistics = (): Logistics => ({
    timeZone: zone() || (props.runAs.find(option => option.id === runAs())?.timeZone ?? browserZone()),
    checkInAt: checkInAt(),
    venue: venue(),
    address: address()
  });
  const setLogistics = { timeZone: setZone, checkInAt: setCheckInAt, venue: setVenue, address: setAddress };
  /** Run under the account's own name or an unsanctioned store's: never sanctioned. */
  const own = () => !props.runAs.find(option => option.id === runAs())?.sanctions;
  const sanctioned = () => !own() && sanctionedChoice();
  const selectedEventType = () => (own() && !['local', 'prerelease'].includes(eventType()) ? 'local' : eventType());
  const timeLimits = () => eventTimeLimits(selectedEventType());
  const needsName = () => swiss() && !name().trim();
  const needsPlayTools = () => (swiss() ? sanctioned() : props.tdfSanctioned);
  const shortRounds = () => swiss() && sanctioned() && Number(roundTime()) < SANCTIONED.minutes;
  const invalidMinutes = () => swiss() && !isRoundMinutes(Number(roundTime()));
  const limited = () => props.community && runAs() === null;
  const day = () => eventDay(startsAt(), localToday());
  const dayTaken = () => limited() && props.communityDays.includes(day());
  const cannotCreate = () =>
    [
      props.busy,
      needsName(),
      invalidMinutes(),
      shortRounds(),
      dayTaken(),
      needsPlayTools() && !playToolsConfirmed()
    ].some(Boolean);
  /** A sanctioned event plays at least three rounds, so a lower cap goes back to the recommendation. */
  function setSanctionedTo(value: boolean) {
    setSanctioned(value);
    if (value && roundCap() > 0 && roundCap() < SANCTIONED.swissRounds) {
      setRoundCap(0);
    }
  }

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
    setSanctionedTo(fill.sanctioned);
    // Listed on pokemon.com is what being created in Play! Tools leads to.
    setPlayToolsConfirmed(fill.sanctioned);
  }
  function chooseRunAs(id: string | null) {
    setRunAs(id);
    setListing(null);
  }

  function submit(event: Event) {
    event.preventDefault();
    if (cannotCreate()) {
      return;
    }
    const from = own() ? null : listing();
    props.onCreate({
      name: name().trim(),
      roundTime: Number(roundTime()),
      eventType: selectedEventType(),
      store: runAs(),
      today: localToday(),
      ...(from ? { sanctionId: from.sanctionId } : {}),
      settings: {
        format: format(),
        startsAt: startsAt(),
        ...logistics(),
        deckVisibility: archetypes(),
        decklists: decklists(),
        playerReporting: reporting(),
        ...(swiss() ? { sanctioned: sanctioned(), roundCap: roundCap() } : {})
      }
    });
  }

  return (
    <form class='tm-setup' onSubmit={submit}>
      <div class='tm-setup-head'>
        <h2>New event</h2>
      </div>
      <SetupName swiss={swiss()} name={name()} tdfName={props.tdfName} onInput={setName} />
      <Show when={props.runAs.length > 1}>
        <div class='tm-box'>
          <SettingRow label='Run as' for='setup-run-as'>
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
      <Show when={swiss() && !own() && runAs()}>
        {store => <ListingPicker storeId={store()} picked={listing()?.sanctionId ?? ''} onPick={pick} />}
      </Show>
      <div class='tm-box'>
        <Show when={listing()}>
          {picked => (
            <SettingRow label='Sanction ID'>
              <span class='tm-set-inline'>
                <span class='tm-num'>{picked().sanctionId}</span>
                <span class='muted'>{LISTING_KINDS[picked().kind]}</span>
              </span>
            </SettingRow>
          )}
        </Show>
        <Show when={swiss() && !own()}>
          <SettingRow label='Sanctioned'>
            <Toggle label='Sanctioned' value={sanctioned()} on='Yes' off='No' onChange={setSanctionedTo} />
          </SettingRow>
        </Show>
        <Show when={needsPlayTools()}>
          <SettingRow label='Play! Tools'>
            <div class='tm-field'>
              <div class='tm-set-inline'>
                <a href='https://play-tools.pokemon.com/' target='_blank' rel='noopener noreferrer'>
                  Play! Tools
                </a>
                <a href='https://play-tools.pokemon.com/guide' target='_blank' rel='noopener noreferrer'>
                  Sanctioning guide
                </a>
              </div>
              <label class='tm-check'>
                <input
                  type='checkbox'
                  required
                  checked={playToolsConfirmed()}
                  onChange={e => setPlayToolsConfirmed(e.currentTarget.checked)}
                />
                I’ve created this event in Play! Tools
              </label>
            </div>
          </SettingRow>
        </Show>
        <SettingRow label='Format' for='setup-format'>
          <FormatSelect id='setup-format' value={format()} onChange={setFormat} />
        </SettingRow>
        <SettingRow label='Starts' for='setup-starts'>
          <input
            id='setup-starts'
            class='tm-input'
            type='datetime-local'
            value={startsAt()}
            onInput={e => setStartsAt(e.currentTarget.value)}
          />
        </SettingRow>
        <LogisticsRows id='setup' value={logistics()} onChange={(key, value) => setLogistics[key](value)} />
        <Show when={swiss()}>
          <SettingRow label='Event type'>
            <EventTypeSwitch
              value={selectedEventType()}
              types={own() ? ['local', 'prerelease'] : undefined}
              onChange={setEventType}
            />
          </SettingRow>
          <SettingRow label='Swiss round minutes' for='setup-minutes'>
            <input
              id='setup-minutes'
              class='tm-input tm-set-minutes'
              type='number'
              required
              step='1'
              aria-describedby={invalidMinutes() ? 'setup-minutes-status' : undefined}
              min={sanctioned() ? Math.max(SANCTIONED.minutes, timeLimits().minimum) : timeLimits().minimum}
              max={timeLimits().maximum}
              value={roundTime()}
              onInput={e => setRoundTime(e.currentTarget.value)}
            />
          </SettingRow>
          <SettingRow label='Swiss rounds' for='setup-rounds'>
            <RoundsSelect
              id='setup-rounds'
              value={roundCap()}
              min={sanctioned() ? SANCTIONED.swissRounds : 1}
              onChange={setRoundCap}
            />
          </SettingRow>
        </Show>
        <SettingRow label='Mobile result reporting' info={<SettingInfo text={reportingInfo(sanctioned())} />}>
          <Toggle label='Mobile result reporting' value={reporting()} onChange={setReporting} />
        </SettingRow>
        <SettingRow label='Archetypes' for='setup-archetypes' info={<SettingInfo text={SETTING_INFO.archetypes} />}>
          <ArchetypesSelect id='setup-archetypes' value={archetypes()} onChange={setArchetypes} />
        </SettingRow>
        <SettingRow label='Decklists' info={<SettingInfo text={SETTING_INFO.decklists} />}>
          <DecklistsSwitch value={decklists()} onChange={setDecklists} />
        </SettingRow>
      </div>
      <SetupFooter
        limited={limited()}
        dayTaken={dayTaken()}
        day={day()}
        invalidMinutes={invalidMinutes()}
        needsName={needsName()}
        shortRounds={shortRounds()}
        cannotCreate={cannotCreate()}
        onCancel={props.onCancel}
      />
      <ErrorLine message={props.error} />
    </form>
  );
}

function SetupFooter(props: {
  limited: boolean;
  dayTaken: boolean;
  day: string;
  invalidMinutes: boolean;
  needsName: boolean;
  shortRounds: boolean;
  cannotCreate: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      <Show when={props.limited}>
        <p class='muted' role='status'>
          One community event per date · up to {CREATIONS_PER_DAY.community} creations in 24 hours.
          <Show when={props.dayTaken}> An event already uses {props.day}.</Show>
        </p>
      </Show>
      <Show when={props.invalidMinutes}>
        <p id='setup-minutes-status' class='tm-error' role='status'>
          Enter whole minutes from 1 to 180
        </p>
      </Show>
      <div class='tm-setup-foot'>
        <Show when={props.needsName}>
          <span class='muted'>Name the event to create it</span>
        </Show>
        <Show when={!props.needsName && props.shortRounds}>
          <span class='muted'>Sanctioned rounds are at least {SANCTIONED.minutes} minutes</span>
        </Show>
        <button type='submit' class='btn btn-primary' disabled={props.cannotCreate}>
          Create event
        </button>
        <button type='button' class='btn btn-ghost' onClick={() => props.onCancel()}>
          Cancel
        </button>
      </div>
    </>
  );
}

function SetupName(props: { swiss: boolean; name: string; tdfName?: string; onInput: (value: string) => void }) {
  return (
    <div class='tm-box'>
      <SettingRow label='Event name' for='setup-name'>
        <Show
          when={props.swiss}
          fallback={
            <p class='tm-setup-file'>
              <strong>{props.tdfName}</strong>
            </p>
          }
        >
          <input
            id='setup-name'
            class='tm-input tm-setup-name'
            maxLength={120}
            placeholder='Event name'
            aria-label='Event name'
            value={props.name}
            ref={el => queueMicrotask(() => el.focus())}
            onInput={e => props.onInput(e.currentTarget.value)}
          />
        </Show>
      </SettingRow>
    </div>
  );
}
