/**
 * The console's event tab, as bordered boxes of settings rows (label at left,
 * control at right): the event itself (name, round lengths, Swiss rounds),
 * what players see and do (start, format, archetypes, sanctioned, reporting,
 * decklists, details), a store event's big screen preset (StoreDisplays),
 * finishing (end or reopen, the .tdf), the staff invite
 * and who is on staff, and deleting the event. Each box of settings saves on
 * its own and says when it has unsaved changes; anything that cannot be taken
 * back asks first.
 */

import { useNavigate } from '@solidjs/router';
import { createResource, createSignal, For, type JSX, Show } from 'solid-js';
import { eventTimeLimits } from '../../../shared/tournament/create';
import { eventTypeOf, recommendedStructure, SANCTIONED } from '../../../shared/tournament/structure';
import type { EventType } from '../../../shared/tournament/types';
import { swissAttendance } from '../../../shared/tournament/rounds';
import { isSanctioned, SETTINGS_LIMITS, type TournamentSettings } from '../../../shared/tournament/view';
import type { DisplayPreset } from '../../../shared/tournament/display';
import {
  call,
  deleteTournament,
  errorText,
  fetchStaff,
  json,
  type Manage,
  removeStaff,
  rotateStaffToken,
  saveSettings
} from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { downloadBlob } from '../../lib/download';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { FormatSelect } from './FormatSelect';
import { session } from './session';
import type { ManageState } from './manageState';
import { DecklistsSwitch, EventTypeSwitch, RoundsSelect } from './SettingChoices';
import { ArchetypesSelect, SettingRow, Toggle } from './SettingControls';
import { type Logistics, LogisticsRows } from './LogisticsRows';
import { reportingInfo, SETTING_INFO, SettingInfo } from './SettingInfo';

/** A box of settings with its heading, and a foot with Save and whether anything is unsaved. */
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
            <span class='muted'>Unsaved changes</span>
          </Show>
          <button type='submit' class='btn btn-primary' disabled={props.busy || !props.dirty}>
            Save
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

function EventDetails(props: { state: ManageState; manage: Manage }) {
  const info = () => props.manage.tournament.info;
  const [name, setName] = createSignal(info().name);
  const [roundTime, setRoundTime] = createSignal(
    info().eventType === 'prerelease' ? Math.max(30, info().roundTime) : info().roundTime
  );
  const [finals, setFinals] = createSignal(info().finalsRoundTime);
  const [eventType, setEventType] = createSignal(eventTypeOf({ info: info() }));
  const timeLimits = () => eventTimeLimits(eventType());
  const minMinutes = () =>
    isSanctioned(props.manage) ? Math.max(SANCTIONED.minutes, timeLimits().minimum) : timeLimits().minimum;
  // eslint-disable-next-line solid/reactivity -- the form edits a copy taken when it opens; saving replaces the event
  const [roundCap, setRoundCap] = createSignal(props.manage.settings.roundCap);
  const infoDirty = () =>
    name() !== info().name ||
    roundTime() !== info().roundTime ||
    finals() !== info().finalsRoundTime ||
    eventType() !== eventTypeOf(props.manage.tournament);
  const capDirty = () => roundCap() !== props.manage.settings.roundCap;
  // The rounds are a setting and the rest the event's own details, so each goes where it is kept.
  async function save() {
    const { code } = props.manage;
    const details = { name: name(), roundTime: roundTime(), finalsRoundTime: finals(), eventType: eventType() };
    const saved = !infoDirty() || (await props.state.send({ type: 'updateInfo', info: details }));
    const cap = roundCap();
    if (saved && capDirty()) {
      await props.state.run(() => saveSettings(code, { roundCap: cap }));
    }
  }
  return (
    <SettingsBox title='Event' dirty={infoDirty() || capDirty()} busy={props.state.busy()} onSave={() => void save()}>
      <SettingRow label='Event name' for='info-name'>
        <input id='info-name' class='tm-input' value={name()} onInput={e => setName(e.currentTarget.value)} />
      </SettingRow>
      <SettingRow label='Event type'>
        <EventTypeSwitch
          value={eventType()}
          types={props.manage.store === null && !isSanctioned(props.manage) ? ['local', 'prerelease'] : undefined}
          onChange={setEventType}
        />
      </SettingRow>
      <SettingRow label='Swiss round minutes' for='info-round'>
        <input
          id='info-round'
          class='tm-input tm-set-minutes'
          type='number'
          min={minMinutes()}
          max={timeLimits().maximum}
          value={roundTime()}
          onInput={e => setRoundTime(Number(e.currentTarget.value))}
        />
      </SettingRow>
      <SettingRow label='Top cut round minutes' for='info-finals'>
        <input
          id='info-finals'
          disabled={['local', 'prerelease'].includes(eventType()) && props.manage.tournament.settings?.type !== 3}
          class='tm-input tm-set-minutes'
          type='number'
          min={minMinutes()}
          max={timeLimits().maximum}
          value={finals()}
          onInput={e => setFinals(Number(e.currentTarget.value))}
        />
      </SettingRow>
      <SettingRow label='Swiss rounds' for='info-rounds'>
        <RoundsSelect
          id='info-rounds'
          value={roundCap()}
          recommended={recommendedRounds(props.manage, eventType())}
          min={isSanctioned(props.manage) ? SANCTIONED.swissRounds : 1}
          onChange={setRoundCap}
        />
      </SettingRow>
    </SettingsBox>
  );
}

type PlayerSettings = Logistics &
  Pick<
    TournamentSettings,
    'details' | 'format' | 'startsAt' | 'deckVisibility' | 'sanctioned' | 'playerReporting' | 'decklists'
  >;

const pickPlayerSettings = (settings: TournamentSettings): PlayerSettings => {
  const { details, format, startsAt, deckVisibility, sanctioned, playerReporting, decklists } = settings;
  const { timeZone, checkInAt, venue, address } = settings;
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
    decklists
  };
};

function ForPlayers(props: { state: ManageState; manage: Manage }) {
  // eslint-disable-next-line solid/reactivity -- the form edits a copy taken when it opens; saving replaces the event
  const [draft, setDraft] = createSignal<PlayerSettings>(pickPlayerSettings(props.manage.settings));
  const set = <K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]) =>
    setDraft({ ...draft(), [key]: value });
  const dirty = () => {
    const saved = pickPlayerSettings(props.manage.settings);
    return (Object.keys(saved) as (keyof PlayerSettings)[]).some(key => saved[key] !== draft()[key]);
  };
  function save() {
    const { code } = props.manage;
    const next = draft();
    void props.state.run(() => saveSettings(code, next));
  }
  return (
    <SettingsBox title='For players' dirty={dirty()} busy={props.state.busy()} onSave={save}>
      <SettingRow label='Starts' for='set-start'>
        <input
          id='set-start'
          class='tm-input'
          type='datetime-local'
          value={draft().startsAt}
          onInput={e => set('startsAt', e.currentTarget.value)}
        />
      </SettingRow>
      <LogisticsRows id='set' value={draft()} onChange={set} />
      <SettingRow label='Format' for='set-format'>
        <FormatSelect id='set-format' value={draft().format} onChange={value => set('format', value)} />
      </SettingRow>
      <SettingRow label='Archetypes' for='set-decks' info={<SettingInfo text={SETTING_INFO.archetypes} />}>
        <ArchetypesSelect id='set-decks' value={draft().deckVisibility} onChange={v => set('deckVisibility', v)} />
      </SettingRow>
      {/* Only a store's event is sanctioned; one sanctioned before stores existed can still be turned off. */}
      <Show when={props.manage.mode === 'swiss' && (props.manage.store !== null || props.manage.settings.sanctioned)}>
        <SettingRow label='Sanctioned'>
          <Toggle
            label='Sanctioned'
            value={draft().sanctioned}
            on='Yes'
            off='No'
            onChange={v => set('sanctioned', v)}
          />
        </SettingRow>
      </Show>
      <SettingRow label='Mobile result reporting' info={<SettingInfo text={reportingInfo(draft().sanctioned)} />}>
        <Toggle
          label='Mobile result reporting'
          value={draft().playerReporting}
          onChange={v => set('playerReporting', v)}
        />
      </SettingRow>
      <SettingRow label='Decklists' info={<SettingInfo text={SETTING_INFO.decklists} />}>
        <DecklistsSwitch value={draft().decklists} onChange={v => set('decklists', v)} />
      </SettingRow>
      <SettingRow label='Event description' for='set-details'>
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
        tdfFilename(manage.tournament)
      );
      return manage;
    });
  };
  function setFinished(finished: boolean) {
    const { code } = props.manage;
    void props.state.run(() => saveSettings(code, { finished }));
  }
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>Finish</h2>
      <div class='tm-box'>
        <SettingRow label='Status'>
          <span class='tm-set-inline'>
            <span>{props.manage.settings.finished ? 'Ended' : 'In progress'}</span>
            <Show
              when={props.manage.settings.finished}
              fallback={
                <ConfirmAction
                  class='btn btn-secondary'
                  label='End event'
                  question='End the event?'
                  confirmLabel='End event'
                  onConfirm={() => setFinished(true)}
                />
              }
            >
              <button
                type='button'
                class='btn btn-secondary'
                disabled={props.state.busy()}
                onClick={() => setFinished(false)}
              >
                Reopen event
              </button>
            </Show>
          </span>
        </SettingRow>
        <Show when={isSanctioned(props.manage)}>
          <SettingRow label='Play! Pokémon file'>
            <button type='button' class='btn btn-secondary' onClick={download}>
              Download .tdf
            </button>
          </SettingRow>
        </Show>
      </div>
    </section>
  );
}

function StaffInvite(props: { state: ManageState; manage: Manage }) {
  const [copied, setCopied] = createSignal(false);
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
      <h2 class='tm-subhead tm-box-head'>Staff</h2>
      <div class='tm-box'>
        <SettingRow label='Invite link'>
          <span class='tm-set-inline tm-invite'>
            <Show
              when={revealed()}
              fallback={
                <button
                  type='button'
                  class='tm-input tm-link tm-secret'
                  aria-label='Show the staff invite link'
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
                aria-label='Staff invite link'
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
              {copied() ? 'Copied' : 'Copy invite link'}
            </button>
            <ConfirmAction
              class='btn btn-ghost'
              label='New link'
              question='Make a new link and remove current staff?'
              confirmLabel='Remove staff'
              danger
              onConfirm={rotate}
            />
          </span>
        </SettingRow>
        <StaffList manage={props.manage} />
      </div>
    </section>
  );
}

const joinedOn = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Who runs the event: the organizer first, then everyone the invite link let
 * in, and when, so a link that went further than meant shows; each of them
 * can be removed.
 */
function StaffList(props: { manage: Manage }) {
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
    }
  }
  return (
    <SettingRow label='On staff'>
      <ul class='tm-staff-list'>
        <Show when={organizer()}>
          {name => (
            <li>
              <span>
                {name()}
                <span class='muted'> · organizer</span>
              </span>
            </li>
          )}
        </Show>
        <For each={latestValue(staff)}>
          {member => (
            <li>
              <span>
                {member.name}
                <Show when={member.joinedAt}>{at => <span class='muted'> · joined {joinedOn(at())}</span>}</Show>
              </span>
              <ConfirmAction
                label='Remove'
                question={`Remove ${member.name} from staff?`}
                confirmLabel='Remove'
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
  return (
    <section class='tm-box tm-danger-box'>
      <SettingRow label='Delete this event'>
        <ConfirmAction
          class='btn btn-secondary tm-danger'
          label='Delete event'
          question={`Delete ${props.manage.tournament.info.name} for good?`}
          confirmLabel='Delete'
          danger
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
    const preset = value() || null;
    void props.state
      .run(() => call<Manage>(displayPath(code), json('PUT', { preset })))
      .then(saved => {
        // A refused save keeps the pick on screen, unsaved, to try again.
        if (saved) {
          setPicked(null);
        }
      });
  }
  return (
    <SettingsBox title='Big screen' dirty={value() !== (kept()?.id ?? '')} busy={props.state.busy()} onSave={save}>
      <SettingRow label='Display preset' for='set-display'>
        <select id='set-display' class='tm-select' value={value()} onChange={e => setPicked(e.currentTarget.value)}>
          <option value=''>Automatic</option>
          <For each={choices()}>{preset => <option value={preset.id}>{preset.name}</option>}</For>
        </select>
      </SettingRow>
      <ErrorLine message={read.error ? errorText(read.error) : null} />
    </SettingsBox>
  );
}

export function EventPanel(props: { state: ManageState; manage: Manage }) {
  return (
    <div class='tm-panel tm-event-panel'>
      <Show when={props.manage.mode === 'swiss'}>
        <EventDetails state={props.state} manage={props.manage} />
      </Show>
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
