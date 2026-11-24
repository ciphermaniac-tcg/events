/**
 * The console's event tab, as bordered boxes of settings rows (label at left,
 * control at right): the event as players find it (name, when and where,
 * fee, cap, description), its rules (kind and sanctioning, format, decks,
 * rounds, reporting), a store event's big screen preset (StoreDisplays),
 * a TOM event's file (TomFileRow), the staff invite and who is on staff,
 * finishing (end or reopen once round 1 is paired, the .tdf), and deleting
 * the event. Each field saves as it is left, with no Save to press, the way
 * check-in ticks do; anything that cannot be taken back asks first.
 */

import { useNavigate } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, type JSX, Show, untrack } from 'solid-js';
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
import { intlLocale, t, tn } from '../../lib/i18n';
import { latestValue } from '../../lib/resource';
import { downloadBlob } from '../../lib/download';
import { createCopied } from './copied';
import { ConfirmAction } from './ConfirmAction';
import { registrantsSource, siteRegistrants } from './siteRegistrants';
import { queueSave, type SettingsDraft, settingsDraft } from './settingsDrafts';
import { ErrorLine } from './Field';
import { FormatSelect } from './FormatSelect';
import { EndEventStep } from './NextStep';
import { session } from './session';
import type { ManageState } from './manageState';
import { ALWAYS_SANCTIONED, DecklistsSwitch, EventTypeSelect, RoundsSelect } from './SettingChoices';
import { ArchetypesSelect, SettingRow, Toggle } from './SettingControls';
import { checkInAfterStart } from './checkInTime';
import { FeeField, fieldNumber, type Logistics, LogisticsRows } from './LogisticsRows';
import { reportingInfo, SETTING_INFO, SettingInfo } from './SettingInfo';
import { TomFileRow, type TomLink } from './TomSyncPanel';

/**
 * A box of settings with its heading. Every field saves as it is left, or at
 * once for a choice (see SettingsForm), so the box has no Save of its own: a
 * change event from any field in it saves, and Enter in a field does too.
 */
function SettingsBox(props: { title: string; onSave: () => void; children: JSX.Element }) {
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>{props.title}</h2>
      <form
        class='tm-box tm-set-box'
        onChange={() => props.onSave()}
        onSubmit={event => {
          event.preventDefault();
          props.onSave();
        }}
      >
        {props.children}
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

/** The event's own details, which change by command rather than as settings. */
interface EventFields {
  name: string;
  roundTime: number;
  finalsRoundTime: number;
  eventType: EventType;
}

const eventFields = (manage: Manage): EventFields => {
  const { name, roundTime, finalsRoundTime } = manage.tournament.info;
  return { name, roundTime, finalsRoundTime, eventType: eventTypeOf(manage.tournament) };
};

/** What a row says once round 1 is paired: when a change made now takes effect. Nothing before. */
const midEvent = (manage: Manage, note: string) => (hasStarted(manage.tournament) ? note : undefined);

type PlayerSettings = Logistics &
  Pick<
    TournamentSettings,
    | 'details'
    | 'format'
    | 'startsAt'
    | 'deckVisibility'
    | 'sanctioned'
    | 'playerReporting'
    | 'agreedReportsSettle'
    | 'decklists'
    | 'entryFee'
    | 'playerCap'
    | 'roundCap'
  >;

const pickPlayerSettings = (settings: TournamentSettings): PlayerSettings => {
  const { details, format, startsAt, deckVisibility, sanctioned, playerReporting, decklists } = settings;
  const { agreedReportsSettle, roundCap } = settings;
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
    agreedReportsSettle,
    decklists,
    entryFee,
    playerCap,
    roundCap
  };
};

/** Sends a box's changes through `write`, if it has any; whether nothing was left unsent by a refusal. */
async function sendDraft<T extends object>(
  box: SettingsDraft<T>,
  saved: T,
  write: (changes: Partial<T>) => Promise<boolean>
): Promise<boolean> {
  const changes = box.changes(saved);
  if (Object.keys(changes).length === 0) {
    return true;
  }
  box.sending(changes);
  const ok = await write(changes);
  box.settle(changes, ok);
  return ok;
}

/**
 * The Settings tab's fields, saved as they are left: the edits are kept
 * per event (see settingsDrafts) and `save` sends whatever differs from the
 * event, its details by command and the rest as settings, one save after
 * another. A refused save leaves its edits in their fields, as typed, and
 * says why above the tabs; the next save tries them again. An edit a
 * colleague overtook is dropped rather than sent over theirs, and the tabs
 * say the event changed. Check-in after the start is not sent until one of
 * them moves. Nothing is sent while a number field is out of its range;
 * the field says the range it takes until it is back in it.
 */
interface SettingsForm {
  info: <K extends keyof EventFields>(key: K) => EventFields[K];
  setInfo: <K extends keyof EventFields>(key: K, value: EventFields[K]) => void;
  value: () => PlayerSettings;
  set: <K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]) => void;
  /** The error under number field `id` while its edit is out of its range, as of the last save. */
  rangeError: (id: string) => string | undefined;
  /** Saves, once every number edited is in its range. */
  save: () => void;
}

/** The minutes a Swiss or top cut round of `type` may run at this event. */
function minuteRange(manage: Manage, type: EventType) {
  const { minimum, maximum } = eventTimeLimits(type);
  return { min: isSanctioned(manage) ? Math.max(SANCTIONED.minutes, minimum) : minimum, max: maximum };
}

/** Whether top cut minutes are not asked: a Local or Prerelease has none of its own, unless TOM runs it as a Cup. */
const finalsFixed = (manage: Manage, type: EventType) =>
  ['local', 'prerelease'].includes(type) && manage.tournament.settings?.type !== 3;

interface NumberField {
  id: string;
  key: keyof EventFields | keyof PlayerSettings;
  min: number;
  max: number;
  /** The smallest step it takes: whole numbers unless said. */
  step?: number;
}

/** Whether `value` is one `field` takes, as its input's own min, max and step check it. */
const fits = (value: number, { min, max, step = 1 }: NumberField) =>
  value >= min && value <= max && Number.isInteger(Math.round((value / step) * 1e6) / 1e6);

/** Why `value` does not fit `field`: out of its range, or finer than its step. */
function rangeError(field: NumberField, value: number): string {
  if (value < field.min || value > field.max) {
    return t('Enter a number from {min} to {max}.', { min: field.min, max: field.max });
  }
  return field.step ? t('Use at most two decimal places.') : t('Enter a whole number.');
}

/** What a number field takes from its error: marked invalid, and described by the line under it. */
const marked = (id: string, error: string | undefined) => ({
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${id}-error` : undefined
});

/** The settings' number fields, with the ranges they take at this event. */
function numberFields(manage: Manage, type: EventType): NumberField[] {
  const minutes = minuteRange(manage, type);
  return [
    { id: 'info-round', key: 'roundTime', ...minutes },
    { id: 'info-finals', key: 'finalsRoundTime', ...minutes },
    { id: 'set-cap', key: 'playerCap', min: 0, max: SETTINGS_LIMITS.playerCap },
    { id: 'set-fee', key: 'entryFee', min: 0, max: SETTINGS_LIMITS.entryFee, step: 0.01 }
  ];
}

function createSettingsForm(state: ManageState, manage: () => Manage): SettingsForm {
  const { code } = untrack(manage);
  const details = settingsDraft<EventFields>(code, 'event');
  const draft = settingsDraft<PlayerSettings>(code, 'players');
  const savedInfo = () => eventFields(manage());
  const saved = createMemo(() => pickPlayerSettings(manage().settings));
  // The form's values: each edit, or the event's own where there is none, built once for every row that reads them.
  const value = createMemo(() => {
    const now = saved();
    return Object.fromEntries(
      (Object.keys(now) as (keyof PlayerSettings)[]).map(key => [key, draft.value(key, now)])
    ) as unknown as PlayerSettings;
  });
  async function sendBoxes(): Promise<boolean> {
    const info = await sendDraft(details, savedInfo(), changes => state.send({ type: 'updateInfo', info: changes }));
    if (!info || checkInAfterStart(value().checkInAt, value().startsAt)) {
      return false;
    }
    return sendDraft(draft, saved(), changes => state.run(() => saveSettings(code, changes)));
  }
  /**
   * Each number edited out of its field's range, by field id, with the range
   * it takes. A top cut's minutes that are no longer asked are dropped
   * rather than sent or held against the rest.
   */
  function outOfRange(): Record<string, string> {
    const type = details.value('eventType', savedInfo());
    if (finalsFixed(manage(), type)) {
      details.set('finalsRoundTime', savedInfo().finalsRoundTime, savedInfo());
    }
    const edits: Record<string, unknown> = { ...details.changes(savedInfo()), ...draft.changes(saved()) };
    return Object.fromEntries(
      numberFields(manage(), type).flatMap(field => {
        const edit = edits[field.key];
        return typeof edit === 'number' && !fits(edit, field) ? [[field.id, rangeError(field, edit)]] : [];
      })
    );
  }
  const [marks, setMarks] = createSignal<Record<string, string>>({});
  async function send() {
    const out = outOfRange();
    if (Object.keys(out).length > 0) {
      setMarks(out);
      return;
    }
    // Both boxes drop what a colleague overtook, before either sends.
    const overtaken = [details.overtaken(savedInfo()), draft.overtaken(saved())].includes(true);
    if ((await sendBoxes()) && overtaken) {
      state.fail(t('The event changed since you looked. Look again and try once more.'));
    }
  }
  // Checked again as the save's turn comes, against the edits as they are then.
  function save() {
    setMarks(outOfRange());
    queueSave(code, send);
  }
  // A Prerelease's stored short round time is raised as the tab opens, and saved with the next change.
  untrack(() => {
    if (manage().tournament.info.eventType === 'prerelease') {
      details.set('roundTime', Math.max(30, details.value('roundTime', savedInfo())), savedInfo());
    }
  });
  return {
    info: key => details.value(key, savedInfo()),
    setInfo: (key, next) => details.set(key, next, savedInfo()),
    value,
    set: (key, next) => draft.set(key, next, saved()),
    rangeError: id => marks()[id],
    save
  };
}

/** What the cap row says: how to have none, or that a cap under who is in takes nobody new and removes nobody. */
const capNote = (cap: number, registered: number) =>
  cap > 0 && cap < registered
    ? t('{n} players are already registered. Nobody is removed, but no one new can register.', { n: registered })
    : t('Leave blank for no cap.');

/** Where a store's event is played: the store, as its record named it when the event was made. */
function StoreVenue(props: { venue: string; address: string }) {
  return (
    <Show when={props.venue || props.address}>
      <SettingRow label={t('Venue')}>
        <span>{[props.venue, props.address].filter(Boolean).join(', ')}</span>
      </SettingRow>
    </Show>
  );
}

/** The event as players find it: its name, when and where, what it costs, how many it takes, and what it says. */
function EventBox(props: { form: SettingsForm; manage: Manage }) {
  const value = () => props.form.value();
  const registered = () => props.manage.tournament.players.filter(player => player.droppedAfter === null).length;
  return (
    <SettingsBox title={t('Event')} onSave={props.form.save}>
      {/* A TOM event's name is the file's. */}
      <Show when={props.manage.mode === 'swiss'}>
        <SettingRow label={t('Event name')} for='info-name'>
          <input
            id='info-name'
            class='tm-input'
            value={props.form.info('name')}
            onInput={e => props.form.setInfo('name', e.currentTarget.value)}
          />
        </SettingRow>
      </Show>
      <SettingRow label={t('Starts')} for='set-start'>
        <input
          id='set-start'
          class='tm-input'
          type='datetime-local'
          value={value().startsAt}
          onInput={e => props.form.set('startsAt', e.currentTarget.value)}
        />
      </SettingRow>
      <LogisticsRows
        id='set'
        value={value()}
        place={props.manage.store === null}
        startsAt={value().startsAt}
        onChange={props.form.set}
        onFill={props.form.save}
      />
      <Show when={props.manage.store !== null}>
        <StoreVenue venue={value().venue} address={value().address} />
      </Show>
      <SettingRow label={t('Entry fee')} for='set-fee'>
        <FeeField
          id='set-fee'
          country={props.manage.tournament.info.country}
          value={value().entryFee}
          invalid={Boolean(props.form.rangeError('set-fee'))}
          onChange={fee => props.form.set('entryFee', fee)}
        />
        <ErrorLine id='set-fee-error' message={props.form.rangeError('set-fee')} />
      </SettingRow>
      <SettingRow label={t('Player cap')} for='set-cap' note={capNote(value().playerCap, registered())}>
        <input
          id='set-cap'
          class='tm-input tm-set-minutes'
          type='number'
          inputMode='numeric'
          min={0}
          max={SETTINGS_LIMITS.playerCap}
          {...marked('set-cap', props.form.rangeError('set-cap'))}
          value={value().playerCap || ''}
          onInput={e => props.form.set('playerCap', Math.trunc(fieldNumber(e.currentTarget)))}
        />
        <ErrorLine id='set-cap-error' message={props.form.rangeError('set-cap')} />
      </SettingRow>
      <SettingRow label={t('Event description')} for='set-details'>
        <textarea
          id='set-details'
          class='tm-input tm-textarea'
          maxLength={SETTINGS_LIMITS.details}
          value={value().details}
          onInput={e => props.form.set('details', e.currentTarget.value)}
        />
      </SettingRow>
    </SettingsBox>
  );
}

/**
 * The kind of event and whether it is sanctioned, asked only of a Swiss
 * event: only a store's is sanctioned, though one sanctioned before stores
 * existed can still be turned off. A League Cup or Challenge always is, so
 * they are offered once the event is sanctioned, which the server checks
 * (the store's league, round lengths, players' IDs); picking one then
 * changes the kind alone. One that is a Cup or Challenge already keeps every
 * kind to move to.
 */
function EventTypeRow(props: { form: SettingsForm; manage: Manage }) {
  const asked = () => props.manage.store !== null || props.manage.settings.sanctioned;
  const types = () =>
    isSanctioned(props.manage) || ALWAYS_SANCTIONED.includes(eventTypeOf(props.manage.tournament))
      ? undefined
      : (['local', 'prerelease'] as const);
  return (
    <SettingRow
      label={t('Event type')}
      note={midEvent(props.manage, t('Changes the top cut still to come. Rounds played stay as they are.'))}
    >
      <EventTypeSelect
        value={props.form.info('eventType')}
        types={types()}
        sanctioned={asked() ? props.form.value().sanctioned : undefined}
        onChange={type => props.form.setInfo('eventType', type)}
        onSanctioned={on => props.form.set('sanctioned', on)}
      />
    </SettingRow>
  );
}

/** How a Swiss event's rounds run: how long each is and how many Swiss rounds it plans. */
function RoundRows(props: { form: SettingsForm; manage: Manage }) {
  const minutes = () => minuteRange(props.manage, props.form.info('eventType'));
  return (
    <>
      <SettingRow
        label={t('Swiss rounds')}
        for='info-rounds'
        note={midEvent(props.manage, t('The next step follows the new count.'))}
      >
        <RoundsSelect
          id='info-rounds'
          value={props.form.value().roundCap}
          recommended={recommendedRounds(props.manage, props.form.info('eventType'))}
          min={isSanctioned(props.manage) ? SANCTIONED.swissRounds : 1}
          onChange={cap => props.form.set('roundCap', cap)}
        />
      </SettingRow>
      <SettingRow label={t('Swiss round minutes')} for='info-round'>
        <input
          id='info-round'
          class='tm-input tm-set-minutes'
          type='number'
          required
          min={minutes().min}
          max={minutes().max}
          {...marked('info-round', props.form.rangeError('info-round'))}
          value={props.form.info('roundTime')}
          onInput={e => props.form.setInfo('roundTime', Number(e.currentTarget.value))}
        />
        <ErrorLine id='info-round-error' message={props.form.rangeError('info-round')} />
      </SettingRow>
      <SettingRow label={t('Top cut round minutes')} for='info-finals'>
        <input
          id='info-finals'
          disabled={finalsFixed(props.manage, props.form.info('eventType'))}
          class='tm-input tm-set-minutes'
          type='number'
          required
          min={minutes().min}
          max={minutes().max}
          {...marked('info-finals', props.form.rangeError('info-finals'))}
          value={props.form.info('finalsRoundTime')}
          onInput={e => props.form.setInfo('finalsRoundTime', Number(e.currentTarget.value))}
        />
        <ErrorLine id='info-finals-error' message={props.form.rangeError('info-finals')} />
      </SettingRow>
    </>
  );
}

/** How the event runs: its kind, format, decks, rounds and reporting. A switch saves as it is pressed. */
function RulesBox(props: { form: SettingsForm; manage: Manage }) {
  const value = () => props.form.value();
  const choose = <K extends keyof PlayerSettings>(key: K, next: PlayerSettings[K]) => {
    props.form.set(key, next);
    props.form.save();
  };
  const swiss = () => props.manage.mode === 'swiss';
  return (
    <SettingsBox title={t('Rules')} onSave={props.form.save}>
      <Show when={swiss()}>
        <EventTypeRow form={props.form} manage={props.manage} />
      </Show>
      <SettingRow label={t('Format')} for='set-format'>
        <FormatSelect id='set-format' value={value().format} onChange={format => props.form.set('format', format)} />
      </SettingRow>
      <SettingRow
        label={t('Decklists')}
        info={<SettingInfo text={SETTING_INFO.decklists} />}
        note={midEvent(props.manage, t('Players can’t send lists once round 1 is paired.'))}
      >
        <DecklistsSwitch value={value().decklists} onChange={v => choose('decklists', v)} />
      </SettingRow>
      <SettingRow label={t('Archetypes')} for='set-decks' info={<SettingInfo text={SETTING_INFO.archetypes} />}>
        {/* Showing decks sooner than the event does now is the organizer's call alone (see settings.ts). */}
        <ArchetypesSelect
          id='set-decks'
          value={value().deckVisibility}
          soonest={props.manage.role === 'owner' ? undefined : props.manage.settings.deckVisibility}
          onChange={v => props.form.set('deckVisibility', v)}
        />
      </SettingRow>
      <Show when={swiss()}>
        <RoundRows form={props.form} manage={props.manage} />
      </Show>
      <SettingRow
        label={t('Mobile result reporting')}
        info={<SettingInfo text={reportingInfo(value().sanctioned)} />}
        note={midEvent(props.manage, t('Applies to open tables at once.'))}
      >
        <Toggle
          label={t('Mobile result reporting')}
          value={value().playerReporting}
          onChange={v => choose('playerReporting', v)}
        />
      </SettingRow>
      <Show when={value().playerReporting && swiss()}>
        <SettingRow label={t('Agreeing reports count')} info={<SettingInfo text={SETTING_INFO.agreedReportsSettle} />}>
          <Toggle
            label={t('Agreeing reports count')}
            value={value().agreedReportsSettle}
            onChange={v => choose('agreedReportsSettle', v)}
          />
        </SettingRow>
      </Show>
    </SettingsBox>
  );
}

/** End or reopen, and a sanctioned event's .tdf: what an organizer does at the end of the day. */
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
  // Until round 1 there is nothing to end; the head's step ends the event once it runs.
  const status = () => props.manage.settings.finished || hasStarted(props.manage.tournament);
  return (
    <Show when={status() || isSanctioned(props.manage)}>
      <section>
        <h2 class='tm-subhead tm-box-head'>{t('Finish')}</h2>
        <div class='tm-box'>
          <Show when={status()}>
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
          </Show>
          {/* Only a Play! Pokémon event has a file to report. */}
          <Show when={isSanctioned(props.manage)}>
            <SettingRow label={t('Play! Pokémon file')}>
              <span class='tm-set-inline'>
                <button type='button' class='btn btn-secondary' onClick={download}>
                  {t('Download .tdf')}
                </button>
                <span class='muted tm-num'>{t('Version {version}', { version: props.manage.version })}</span>
              </span>
            </SettingRow>
          </Show>
        </div>
      </section>
    </Show>
  );
}

function StaffInvite(props: { state: ManageState; manage: Manage }) {
  const { copied, copy } = createCopied();
  const [removals, setRemovals] = createSignal(0);
  // Blurred until pressed, so the link stays off a screen being shared or projected.
  const [revealed, setRevealed] = createSignal(false);
  function rotate() {
    const { code } = props.manage;
    void props.state.run(() => rotateStaffToken(code));
  }
  const link = () => `${location.origin}/host/${props.manage.code}?invite=${props.manage.staffToken ?? ''}`;
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
            <button type='button' class='btn btn-secondary' onClick={() => void copy(link())}>
              {copied() ? t('Copied') : t('Copy invite link')}
            </button>
            <ConfirmAction
              class='btn btn-ghost'
              label={t('New link')}
              question={t('Make a new link and remove current staff?')}
              scope={t('Everyone on staff loses access to this event, and the current link stops working.')}
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
      .catch((err: unknown) => setError(errorText(err)));
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
            {member => <option value={member.id}>{named(member)}</option>}
          </For>
        </select>
        <ErrorLine message={error()} />
      </span>
    </SettingRow>
  );
}

type Account = { name: string; handle?: string | null };

/** The username said after a staff account's name, where it is not the name already. */
const handleOf = (account: Account) => (account.handle && account.handle !== account.name ? account.handle : null);

/** A staff account as the organizer knows it, as a choice's words: the name, then the username. */
const named = (account: Account) => (handleOf(account) ? `${account.name} @${handleOf(account)}` : account.name);

/** A staff account in the list: the name, then the username, quieter. */
const Named = (props: { account: Account }) => (
  <>
    {props.account.name}
    <Show when={handleOf(props.account)}>{handle => <span class='muted'> @{handle()}</span>}</Show>
  </>
);

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
  const organizer = () => latestValue(session)?.user;
  // Said under the list, beside the row that failed, rather than dropped.
  const [failed, setFailed] = createSignal<string | null>(null);
  async function remove(id: string) {
    setFailed(null);
    try {
      const result = await removeStaff(props.manage.code, id);
      mutate(result.staff);
      props.onRemove();
    } catch (err) {
      setFailed(errorText(err));
    }
  }
  return (
    <SettingRow label={t('On staff')}>
      <ul class='tm-staff-list'>
        <Show when={organizer()}>
          {user => (
            <li>
              <span>
                <Named account={user()} />
                <span class='muted'> · {t('organizer')}</span>
              </span>
            </li>
          )}
        </Show>
        <For each={latestValue(staff)}>
          {member => (
            <li>
              <span>
                <Named account={member} />
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
        <Show when={failed()}>
          {message => (
            <li class='tm-error' role='alert'>
              {message()}
            </li>
          )}
        </Show>
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
        <ErrorLine message={error()} />
      </SettingRow>
    </section>
  );
}

const displayPath = (code: string) => `/api/tournaments/${encodeURIComponent(code)}/display`;

/**
 * Which of the store's display presets the big screen uses. The event keeps
 * a copy of the one it picked, which follows the store's edits until the
 * event ends (see followPreset), so a preset deleted since still shows here
 * by its name until another is picked.
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
    if (sent === null || sent === (kept()?.id ?? '')) {
      return;
    }
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
    <SettingsBox title={t('Big screen')} onSave={save}>
      <SettingRow label={t('Display preset')} for='set-display'>
        <select id='set-display' class='tm-select' value={value()} onChange={e => setPicked(e.currentTarget.value)}>
          <option value=''>{t('Automatic')}</option>
          <For each={choices()}>{preset => <option value={preset.id}>{preset.name}</option>}</For>
        </select>
        {/* Under the field, as every setting's error is. */}
        <ErrorLine message={read.error ? errorText(read.error) : null} />
      </SettingRow>
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
  // eslint-disable-next-line solid/reactivity -- one form per event, kept across tabs (see settingsDrafts)
  const form = createSettingsForm(props.state, () => props.manage);
  return (
    <div class='tm-panel tm-event-panel'>
      {/* Staff change the organizer's event, so they are told a save reaches everyone. */}
      <Show when={props.manage.role !== 'owner'}>
        <p class='muted'>{t('Settings saved here change the event for everyone.')}</p>
      </Show>
      <Show when={props.tom}>{link => <TomFile link={link()} />}</Show>
      <EventBox form={form} manage={props.manage} />
      <RulesBox form={form} manage={props.manage} />
      <Show when={props.manage.store !== null}>
        <BigScreenPreset state={props.state} manage={props.manage} />
      </Show>
      <Show when={props.manage.role === 'owner'}>
        <StaffInvite state={props.state} manage={props.manage} />
      </Show>
      <Finish state={props.state} manage={props.manage} />
      <Show when={props.manage.role === 'owner'}>
        <DeleteEvent manage={props.manage} />
      </Show>
    </div>
  );
}
