/**
 * The console's event tab, as bordered boxes of settings rows (label at left,
 * control at right): the event itself (name, round lengths, Swiss rounds),
 * what players see and do (start, format, archetypes, sanctioned, reporting,
 * decklists, details), a store event's big screen preset (StoreDisplays),
 * a TOM event's file (TomFileRow), finishing (end or reopen, the .tdf), the staff invite
 * and who is on staff, and deleting the event. Each box of settings saves on
 * its own and says when it has unsaved changes; anything that cannot be taken
 * back asks first.
 */

import { useNavigate } from '@solidjs/router';
import { createResource, createSignal, For, type JSX, Show, untrack } from 'solid-js';
import { eventTimeLimits } from '../../../shared/tournament/create';
import { eventTypeOf, recommendedStructure, SANCTIONED } from '../../../shared/tournament/structure';
import type { EventType } from '../../../shared/tournament/types';
import { hasStarted, swissAttendance } from '../../../shared/tournament/rounds';
import { isSanctioned, SETTINGS_LIMITS, type TournamentSettings } from '../../../shared/tournament/view';
import type { DisplayPreset } from '../../../shared/tournament/display';
import {
  call,
  deleteTournament,
  errorText,
  fetchDecklists,
  fetchHeadJudge,
  fetchStaff,
  json,
  type Manage,
  nameHeadJudge,
  removeStaff,
  rotateStaffToken,
  saveSettings
} from '../../lib/tournament/api';
import { currencySymbol } from '../../lib/events/format';
import { intlLocale, t, tn } from '../../lib/i18n';
import { latestValue } from '../../lib/resource';
import { downloadBlob } from '../../lib/download';
import { ConfirmAction } from './ConfirmAction';
import { registrantsSource, siteRegistrants } from './siteRegistrants';
import { settingsDraft } from './settingsDrafts';
import { ErrorLine } from './Field';
import { FormatSelect } from './FormatSelect';
import { EndEventStep } from './NextStep';
import { session } from './session';
import type { ManageState } from './manageState';
import '../../styles/pages/tournament-store-forms.css';
import { DecklistsSwitch, EventTypeSwitch, RoundsSelect } from './SettingChoices';
import { ArchetypesSelect, SettingRow, Toggle } from './SettingControls';
import { type Logistics, LogisticsRows } from './LogisticsRows';
import { reportingInfo, SETTING_INFO, SettingInfo } from './SettingInfo';
import { TomFileRow, type TomLink } from './TomSyncPanel';

/**
 * A box of settings with its heading, and a foot with Save and whether
 * anything is unsaved. Save is the view's primary only while its box has
 * changes to save, so the tab holds one at a time beside the head's step.
 */
function SettingsBox(props: {
  title: string;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  children: JSX.Element;
}) {
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>{props.title}</h2>
      <form
        class='tm-box tm-set-box'
        onSubmit={event => {
          event.preventDefault();
          props.onSave();
        }}
      >
        {props.children}
        <div class='tm-box-bar tm-set-foot'>
          <Show when={props.dirty}>
            <span class='muted'>{t('Unsaved changes')}</span>
          </Show>
          <button
            type='submit'
            class={props.dirty ? 'btn btn-primary' : 'btn btn-secondary'}
            disabled={props.busy || !props.dirty}
          >
            {t('Save')}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Play! Pokémon's Swiss rounds for the players in so far: for an event that
 * pairs everyone together, as most do; none while divisions pair apart, each
 * on its own count, or before anyone is in.
 */
function recommendedRounds(manage: Manage, type: EventType): number | undefined {
  const [pod, ...others] = manage.tournament.pods;
  return pod && others.length === 0 ? recommendedStructure(swissAttendance(pod), type).rounds : undefined;
}

/** The event's own details the Event box edits, with its Swiss rounds, which are a setting. */
interface EventFields {
  name: string;
  roundTime: number;
  finalsRoundTime: number;
  eventType: EventType;
  roundCap: number;
}

const eventFields = (manage: Manage): EventFields => {
  const { name, roundTime, finalsRoundTime } = manage.tournament.info;
  return {
    name,
    roundTime,
    finalsRoundTime,
    eventType: eventTypeOf(manage.tournament),
    roundCap: manage.settings.roundCap
  };
};

/** What a row says once round 1 is paired: when a change made now takes effect. Nothing before. */
const midEvent = (manage: Manage, note: string) => (hasStarted(manage.tournament) ? note : undefined);

function EventDetails(props: { state: ManageState; manage: Manage }) {
  // eslint-disable-next-line solid/reactivity -- one draft per event, kept across tabs (see settingsDrafts)
  const draft = settingsDraft<EventFields>(props.manage.code, 'event');
  const saved = () => eventFields(props.manage);
  const field = <K extends keyof EventFields>(key: K) => draft.value(key, saved());
  const set = <K extends keyof EventFields>(key: K, value: EventFields[K]) => draft.set(key, value, saved());
  // A Prerelease's stored short round time is raised as the box opens.
  untrack(() => {
    if (props.manage.tournament.info.eventType === 'prerelease') {
      set('roundTime', Math.max(30, field('roundTime')));
    }
  });
  const timeLimits = () => eventTimeLimits(field('eventType'));
  const minMinutes = () =>
    isSanctioned(props.manage) ? Math.max(SANCTIONED.minutes, timeLimits().minimum) : timeLimits().minimum;
  // The rounds are a setting and the rest the event's own details, so each goes where it is kept.
  async function save() {
    const { code } = props.manage;
    const { roundCap, ...info } = draft.changes(saved());
    const sent = Object.keys(info).length === 0 || (await props.state.send({ type: 'updateInfo', info }));
    if (sent) {
      draft.forget(info);
    }
    if (sent && roundCap !== undefined && (await props.state.run(() => saveSettings(code, { roundCap })))) {
      draft.forget({ roundCap });
    }
  }
  return (
    <SettingsBox
      title={t('Event')}
      dirty={Object.keys(draft.changes(saved())).length > 0}
      busy={props.state.busy()}
      onSave={() => void save()}
    >
      <SettingRow label={t('Event name')} for='info-name'>
        <input
          id='info-name'
          class='tm-input'
          value={field('name')}
          onInput={e => set('name', e.currentTarget.value)}
        />
      </SettingRow>
      <SettingRow
        label={t('Event type')}
        note={midEvent(props.manage, t('Changes the top cut still to come. Rounds played stay as they are.'))}
      >
        <EventTypeSwitch
          value={field('eventType')}
          types={props.manage.store === null && !isSanctioned(props.manage) ? ['local', 'prerelease'] : undefined}
          onChange={value => set('eventType', value)}
        />
      </SettingRow>
      <SettingRow label={t('Swiss round minutes')} for='info-round'>
        <input
          id='info-round'
          class='tm-input tm-set-minutes'
          type='number'
          min={minMinutes()}
          max={timeLimits().maximum}
          value={field('roundTime')}
          onInput={e => set('roundTime', Number(e.currentTarget.value))}
        />
      </SettingRow>
      <SettingRow label={t('Top cut round minutes')} for='info-finals'>
        <input
          id='info-finals'
          disabled={
            ['local', 'prerelease'].includes(field('eventType')) && props.manage.tournament.settings?.type !== 3
          }
          class='tm-input tm-set-minutes'
          type='number'
          min={minMinutes()}
          max={timeLimits().maximum}
          value={field('finalsRoundTime')}
          onInput={e => set('finalsRoundTime', Number(e.currentTarget.value))}
        />
      </SettingRow>
      <SettingRow
        label={t('Swiss rounds')}
        for='info-rounds'
        note={midEvent(props.manage, t('The next step follows the new count.'))}
      >
        <RoundsSelect
          id='info-rounds'
          value={field('roundCap')}
          recommended={recommendedRounds(props.manage, field('eventType'))}
          min={isSanctioned(props.manage) ? SANCTIONED.swissRounds : 1}
          onChange={value => set('roundCap', value)}
        />
      </SettingRow>
    </SettingsBox>
  );
}

type PlayerSettings = Logistics &
  Pick<
    TournamentSettings,
    | 'details'
    | 'format'
    | 'startsAt'
    | 'deckVisibility'
    | 'sanctioned'
    | 'playerReporting'
    | 'decklists'
    | 'entryFee'
    | 'playerCap'
  >;

const pickPlayerSettings = (settings: TournamentSettings): PlayerSettings => {
  const { details, format, startsAt, deckVisibility, sanctioned, playerReporting, decklists } = settings;
  const { timeZone, checkInAt, venue, address, entryFee, playerCap } = settings;
  return {
    details,
    format,
    startsAt,
    timeZone,
    checkInAt,
    venue,
    address,
    deckVisibility,
    sanctioned,
    playerReporting,
    decklists,
    entryFee,
    playerCap
  };
};

/** What the cap row says: how to have none, or that a cap under who is in takes nobody new and removes nobody. */
const capNote = (cap: number, registered: number) =>
  cap > 0 && cap < registered
    ? t('{n} players are already registered. Nobody is removed, but no one new can register.', { n: registered })
    : t('Leave blank for no cap.');

/** A number field's value as a setting: blank is 0, and so is anything the field could not read. */
const fieldNumber = (input: HTMLInputElement) => (Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0);

/** The entry fee, behind the symbol of the currency the event's country uses. */
function FeeField(props: { id: string; country: string; value: number; onChange: (value: number) => void }) {
  const symbol = () => currencySymbol(props.country) ?? '$';
  return (
    <span class='tm-night-fee'>
      <span class='tm-fee-symbol' aria-hidden='true'>
        {symbol()}
      </span>
      <input
        id={props.id}
        class='tm-input tm-set-minutes'
        style={{ 'padding-left': `calc(14px + ${symbol().length}ch)` }}
        type='number'
        inputMode='decimal'
        min={0}
        step={0.01}
        max={SETTINGS_LIMITS.entryFee}
        value={props.value || ''}
        onInput={e => props.onChange(fieldNumber(e.currentTarget))}
      />
    </span>
  );
}

function ForPlayers(props: { state: ManageState; manage: Manage }) {
  // eslint-disable-next-line solid/reactivity -- one draft per event, kept across tabs (see settingsDrafts)
  const store = settingsDraft<PlayerSettings>(props.manage.code, 'players');
  const saved = () => pickPlayerSettings(props.manage.settings);
  // The form's values: each edit, or the event's own where there is none.
  const draft = () => {
    const now = saved();
    return Object.fromEntries(
      (Object.keys(now) as (keyof PlayerSettings)[]).map(key => [key, store.value(key, now)])
    ) as unknown as PlayerSettings;
  };
  const set = <K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]) => store.set(key, value, saved());
  const registered = () => props.manage.tournament.players.filter(player => player.droppedAfter === null).length;
  async function save() {
    const { code } = props.manage;
    const changes = store.changes(saved());
    if (await props.state.run(() => saveSettings(code, changes))) {
      store.forget(changes);
    }
  }
  return (
    <SettingsBox
      title={t('For players')}
      dirty={Object.keys(store.changes(saved())).length > 0}
      busy={props.state.busy()}
      onSave={() => void save()}
    >
      <SettingRow label={t('Starts')} for='set-start'>
        <input
          id='set-start'
          class='tm-input'
          type='datetime-local'
          value={draft().startsAt}
          onInput={e => set('startsAt', e.currentTarget.value)}
        />
      </SettingRow>
      <LogisticsRows id='set' value={draft()} onChange={set} />
      <SettingRow label={t('Entry fee')} for='set-fee' note={t('Leave blank for a free event.')}>
        <FeeField
          id='set-fee'
          country={props.manage.tournament.info.country}
          value={draft().entryFee}
          onChange={value => set('entryFee', value)}
        />
      </SettingRow>
      <SettingRow label={t('Player cap')} for='set-cap' note={capNote(draft().playerCap, registered())}>
        <input
          id='set-cap'
          class='tm-input tm-set-minutes'
          type='number'
          inputMode='numeric'
          min={0}
          max={SETTINGS_LIMITS.playerCap}
          value={draft().playerCap || ''}
          onInput={e => set('playerCap', Math.trunc(fieldNumber(e.currentTarget)))}
        />
      </SettingRow>
      <SettingRow label={t('Format')} for='set-format'>
        <FormatSelect id='set-format' value={draft().format} onChange={value => set('format', value)} />
      </SettingRow>
      <SettingRow label={t('Archetypes')} for='set-decks' info={<SettingInfo text={SETTING_INFO.archetypes} />}>
        {/* Showing decks sooner than the event does now is the organizer's call alone (see settings.ts). */}
        <ArchetypesSelect
          id='set-decks'
          value={draft().deckVisibility}
          soonest={props.manage.role === 'owner' ? undefined : props.manage.settings.deckVisibility}
          onChange={v => set('deckVisibility', v)}
        />
      </SettingRow>
      {/* Only a store's event is sanctioned; one sanctioned before stores existed can still be turned off. */}
      <Show when={props.manage.mode === 'swiss' && (props.manage.store !== null || props.manage.settings.sanctioned)}>
        <SettingRow label={t('Sanctioned')}>
          <Toggle
            label={t('Sanctioned')}
            value={draft().sanctioned}
            on={t('Yes')}
            off={t('No')}
            onChange={v => set('sanctioned', v)}
          />
        </SettingRow>
      </Show>
      <SettingRow
        label={t('Mobile result reporting')}
        info={<SettingInfo text={reportingInfo(draft().sanctioned)} />}
        note={midEvent(props.manage, t('Applies to open tables at once.'))}
      >
        <Toggle
          label={t('Mobile result reporting')}
          value={draft().playerReporting}
          onChange={v => set('playerReporting', v)}
        />
      </SettingRow>
      <SettingRow
        label={t('Decklists')}
        info={<SettingInfo text={SETTING_INFO.decklists} />}
        note={midEvent(props.manage, t('Players can’t send lists once round 1 is paired.'))}
      >
        <DecklistsSwitch value={draft().decklists} onChange={v => set('decklists', v)} />
      </SettingRow>
      <SettingRow label={t('Event description')} for='set-details'>
        <textarea
          id='set-details'
          class='tm-input tm-textarea'
          maxLength={SETTINGS_LIMITS.details}
          value={draft().details}
          onInput={e => set('details', e.currentTarget.value)}
        />
      </SettingRow>
    </SettingsBox>
  );
}

/** End or reopen, and the .tdf: what an organizer does at the end of the day. */
function Finish(props: { state: ManageState; manage: Manage }) {
  const download = () => {
    const { manage } = props;
    void props.state.run(async () => {
      const { tdfFilename, tdfText } = await import('../../lib/tournament/exportTdf');
      downloadBlob(
        new Blob([tdfText({ ...manage, finished: manage.settings.finished })], { type: 'application/xml' }),
        tdfFilename(manage.tournament, manage.version)
      );
      return manage;
    });
  };
  function reopen() {
    const { code } = props.manage;
    void props.state.run(() => saveSettings(code, { finished: false }));
  }
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>{t('Finish')}</h2>
      <div class='tm-box'>
        <SettingRow label={t('Status')}>
          <span class='tm-set-inline'>
            <span>{props.manage.settings.finished ? t('Ended') : t('In progress')}</span>
            <Show
              when={props.manage.settings.finished}
              fallback={<EndEventStep state={props.state} manage={props.manage} primary={false} />}
            >
              <button type='button' class='btn btn-secondary' disabled={props.state.busy()} onClick={reopen}>
                {t('Reopen event')}
              </button>
            </Show>
          </span>
        </SettingRow>
        <SettingRow label={isSanctioned(props.manage) ? t('Play! Pokémon file') : t('Event file')}>
          <span class='tm-set-inline'>
            <button type='button' class='btn btn-secondary' onClick={download}>
              {t('Download .tdf')}
            </button>
            <span class='muted tm-num'>{t('Version {version}', { version: props.manage.version })}</span>
          </span>
        </SettingRow>
      </div>
    </section>
  );
}

function StaffInvite(props: { state: ManageState; manage: Manage }) {
  const [copied, setCopied] = createSignal(false);
  const [removals, setRemovals] = createSignal(0);
  // Blurred until pressed, so the link stays off a screen being shared or projected.
  const [revealed, setRevealed] = createSignal(false);
  function rotate() {
    const { code } = props.manage;
    void props.state.run(() => rotateStaffToken(code));
  }
  const link = () => `${location.origin}/host/${props.manage.code}?invite=${props.manage.staffToken ?? ''}`;
  async function copy() {
    await navigator.clipboard.writeText(link());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>{t('Staff')}</h2>
      <div class='tm-box'>
        <SettingRow
          label={t('Invite link')}
          note={
            // A store's event is organized by its Owner and every Manager, not by one account.
            props.manage.store
              ? t(
                  'Staff can enter results, manage players and change settings. Only the store’s owner and managers can invite or remove staff and delete the event.'
                )
              : t(
                  'Staff can enter results, manage players and change settings. Only you can invite or remove staff and delete the event.'
                )
          }
        >
          <span class='tm-set-inline tm-invite'>
            <Show
              when={revealed()}
              fallback={
                <button
                  type='button'
                  class='tm-input tm-link tm-secret'
                  aria-label={t('Show the staff invite link')}
                  onClick={() => setRevealed(true)}
                >
                  <span class='tm-secret-text' aria-hidden='true'>
                    {link()}
                  </span>
                </button>
              }
            >
              <input
                class='tm-input tm-link'
                readOnly
                value={link()}
                aria-label={t('Staff invite link')}
                ref={el =>
                  queueMicrotask(() => {
                    el.focus();
                    el.select();
                  })
                }
                onFocus={e => e.currentTarget.select()}
              />
            </Show>
            <button type='button' class='btn btn-secondary' onClick={() => void copy()}>
              {copied() ? t('Copied') : t('Copy invite link')}
            </button>
            <ConfirmAction
              class='btn btn-ghost'
              label={t('New link')}
              question={t('Make a new link and remove current staff?')}
              confirmLabel={t('Remove staff')}
              danger
              onConfirm={rotate}
            />
          </span>
        </SettingRow>
        <StaffList manage={props.manage} onRemove={() => setRemovals(removals() + 1)} />
        <HeadJudge manage={props.manage} removals={removals()} />
      </div>
    </section>
  );
}

/**
 * The head judge, from the event's staff: they may approve a result
 * correction as the organizer may (see Corrections.tsx). Asked for again as
 * the staff changes, since one removed from it is head judge no more.
 */
function HeadJudge(props: { manage: Manage; removals: number }) {
  const [choice, { mutate }] = createResource(
    () => `${props.manage.code} ${props.manage.staffToken ?? ''} ${props.removals}`,
    () => fetchHeadJudge(props.manage.code)
  );
  const [error, setError] = createSignal<string | null>(null);
  async function name(userId: string) {
    setError(null);
    const { code } = props.manage;
    await nameHeadJudge(code, userId || null)
      .then(mutate)
      .catch(err => setError(errorText(err)));
  }
  return (
    <SettingRow label={t('Head judge')} for='head-judge' note={t('May approve result corrections')}>
      <span class='tm-set-inline'>
        <select
          id='head-judge'
          class='tm-select'
          value={latestValue(choice)?.headJudge?.id ?? ''}
          onChange={e => void name(e.currentTarget.value)}
        >
          <option value=''>{t('None')}</option>
          <For each={latestValue(choice)?.staff ?? []}>
            {member => <option value={member.id}>{member.name}</option>}
          </For>
        </select>
        <ErrorLine message={error()} />
      </span>
    </SettingRow>
  );
}

const joinedOn = (at: number) => new Date(at).toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' });

/**
 * Who runs the event: the organizer first, then everyone the invite link let
 * in, and when, so a link that went further than meant shows; each of them
 * can be removed.
 */
function StaffList(props: { manage: Manage; onRemove: () => void }) {
  // A new link removes everyone, so the list is asked for again with each one. The key is a
  // string: an object made afresh from each copy of the event would ask again after every result.
  const [staff, { mutate }] = createResource(
    () => `${props.manage.code} ${props.manage.staffToken ?? ''}`,
    () => fetchStaff(props.manage.code).then(result => result.staff)
  );
  // Only the organizer sees this list, so the organizer is whoever is signed in.
  const organizer = () => latestValue(session)?.user?.name;
  async function remove(id: string) {
    const result = await removeStaff(props.manage.code, id).catch(() => null);
    if (result) {
      mutate(result.staff);
      props.onRemove();
    }
  }
  return (
    <SettingRow label={t('On staff')}>
      <ul class='tm-staff-list'>
        <Show when={organizer()}>
          {name => (
            <li>
              <span>
                {name()}
                <span class='muted'> · {t('organizer')}</span>
              </span>
            </li>
          )}
        </Show>
        <For each={latestValue(staff)}>
          {member => (
            <li>
              <span>
                {member.name}
                <Show when={member.joinedAt}>
                  {at => <span class='muted'> · {t('joined {date}', { date: joinedOn(at()) })}</span>}
                </Show>
              </span>
              <ConfirmAction
                label={t('Remove')}
                question={t('Remove {name} from staff?', { name: member.name })}
                confirmLabel={t('Remove')}
                danger
                onConfirm={() => void remove(member.id)}
              />
            </li>
          )}
        </For>
      </ul>
    </SettingRow>
  );
}

/**
 * What deleting the event takes with it, once it holds anything: its players
 * and rounds, by count. `registrants`: those registered on the site that a
 * TOM event's file does not list yet.
 */
function deletedScope(manage: Manage, registrants: number): string | undefined {
  const players = manage.tournament.players.length + registrants;
  const rounds = Math.max(0, ...manage.tournament.pods.map(pod => pod.rounds.length));
  if (players === 0) {
    return undefined;
  }
  const counted = tn(players, '{n} player', '{n} players');
  return rounds === 0
    ? t('{players} and any decklists are deleted for good.', { players: counted })
    : t('{players}, {rounds} of results, and any decklists are deleted for good.', {
        players: counted,
        rounds: tn(rounds, '{n} round', '{n} rounds')
      });
}

/**
 * Deleting the event: an empty one asks in place, and one with players or
 * rounds asks in a dialog that counts them, taking the answer only once the
 * event's code is typed. A TOM event counts those registered on the site
 * before its file comes in.
 */
function DeleteEvent(props: { manage: Manage }) {
  const navigate = useNavigate();
  const [error, setError] = createSignal<string | null>(null);
  async function remove() {
    try {
      await deleteTournament(props.manage.code);
      navigate('/');
    } catch (err) {
      setError(errorText(err));
    }
  }
  const [lists] = createResource(
    () => registrantsSource(props.manage),
    code => fetchDecklists(code)
  );
  const scope = () => deletedScope(props.manage, siteRegistrants(props.manage, lists.latest?.decklists ?? []).length);
  return (
    <section class='tm-box tm-danger-box'>
      <SettingRow label={t('Delete this event')}>
        <ConfirmAction
          class='btn btn-secondary tm-danger'
          label={t('Delete event')}
          question={t('Delete {name} for good?', { name: props.manage.tournament.info.name })}
          scope={scope()}
          typed={scope() ? props.manage.code : undefined}
          confirmLabel={t('Delete')}
          danger
          disabled={lists.loading}
          onConfirm={() => void remove()}
        />
      </SettingRow>
      <ErrorLine message={error()} />
    </section>
  );
}

const displayPath = (code: string) => `/api/tournaments/${encodeURIComponent(code)}/display`;

/**
 * Which of the store's display presets the big screen uses. The event keeps
 * a copy of the one it picked, so a preset edited or deleted since still
 * shows here by its name until another is picked.
 */
function BigScreenPreset(props: { state: ManageState; manage: Manage }) {
  const [read] = createResource(
    () => props.manage.code,
    code => call<{ presets: DisplayPreset[] }>(displayPath(code))
  );
  const kept = () => props.manage.settings.display;
  const [picked, setPicked] = createSignal<string | null>(null);
  const value = () => picked() ?? kept()?.id ?? '';
  const choices = () => {
    const presets = latestValue(read)?.presets ?? [];
    const copy = kept();
    return copy && !presets.some(preset => preset.id === copy.id) ? [...presets, copy] : presets;
  };
  function save() {
    const { code } = props.manage;
    const sent = picked();
    const preset = value() || null;
    void props.state
      .run(() => call<Manage>(displayPath(code), json('PUT', { preset })))
      .then(saved => {
        // A refused save keeps the pick on screen, unsaved, to try again; so does one picked since it was sent.
        if (saved) {
          setPicked(now => (now === sent ? null : now));
        }
      });
  }
  return (
    <SettingsBox title={t('Big screen')} dirty={value() !== (kept()?.id ?? '')} busy={props.state.busy()} onSave={save}>
      <SettingRow label={t('Display preset')} for='set-display'>
        <select id='set-display' class='tm-select' value={value()} onChange={e => setPicked(e.currentTarget.value)}>
          <option value=''>{t('Automatic')}</option>
          <For each={choices()}>{preset => <option value={preset.id}>{preset.name}</option>}</For>
        </select>
      </SettingRow>
      <ErrorLine message={read.error ? errorText(read.error) : null} />
    </SettingsBox>
  );
}

/** A TOM event's file, and that TOM pairs it: set when the event was made, so only said here. */
function TomFile(props: { link: TomLink }) {
  return (
    <section aria-labelledby='tom-file-head'>
      <h2 id='tom-file-head' class='tm-subhead tm-box-head'>
        {t('TOM')}
      </h2>
      <div class='tm-box'>
        <SettingRow label={t('Pairing and results')} info={<SettingInfo text={SETTING_INFO.pairing} />}>
          <span>{t('TOM')}</span>
        </SettingRow>
        <TomFileRow link={props.link} />
      </div>
    </section>
  );
}

export function EventPanel(props: { state: ManageState; manage: Manage; tom: TomLink | null }) {
  return (
    <div class='tm-panel tm-event-panel'>
      {/* Staff change the organizer's event, so they are told a save reaches everyone. */}
      <Show when={props.manage.role !== 'owner'}>
        <p class='muted'>{t('Settings saved here change the event for everyone.')}</p>
      </Show>
      <Show when={props.manage.mode === 'swiss'}>
        <EventDetails state={props.state} manage={props.manage} />
      </Show>
      <Show when={props.tom}>{link => <TomFile link={link()} />}</Show>
      <ForPlayers state={props.state} manage={props.manage} />
      <Show when={props.manage.store !== null}>
        <BigScreenPreset state={props.state} manage={props.manage} />
      </Show>
      <Finish state={props.state} manage={props.manage} />
      <Show when={props.manage.role === 'owner'}>
        <StaffInvite state={props.state} manage={props.manage} />
        <DeleteEvent manage={props.manage} />
      </Show>
    </div>
  );
}
