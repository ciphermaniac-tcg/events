/**
 * Store settings' Displays: the store's big screen presets, each made from
 * the room it is for. A Manager gives the screen's size and how far back the
 * farthest player stands; the text size follows (roomScale) and can be
 * nudged from there. The preview draws the screen at that size. An event in
 * the store picks a preset from its Event tab and keeps its own copy.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import {
  DEFAULT_DISPLAY,
  type DisplayLayout,
  type DisplayOptions,
  type DisplayPreset,
  type DisplayRoom,
  FEET_PER_METRE,
  MAX_DISPLAY_PRESETS,
  ROOM_LIMITS,
  roomFeet,
  roomInReach,
  SCALE_LIMITS
} from '../../../shared/tournament/display';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { call, errorText, json } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { measuresInFeet, msg, t, tn } from '../../lib/i18n';
import { ConfirmAction } from './ConfirmAction';
import { roomScale } from './displayLayout';
import { ErrorLine } from './Field';
import { createAction } from './action';
import { SaveBar } from './StoreSave';
import { SettingRow } from './SettingControls';

const LAYOUT_WORDS: Record<DisplayLayout, string> = {
  auto: msg('Automatic'),
  faceoff: msg('Face-off scroll'),
  tables: msg('Table pages'),
  alphabetical: msg('Alphabetical pages')
};
const TIMINGS = [0, 10, 15, 20, 30] as const;
/** A 55-inch screen read from about 15 feet, in the reader's own unit. */
const defaultRoom = (): DisplayRoom => (measuresInFeet() ? { inches: 55, feet: 15 } : { inches: 55, metres: 4.5 });
const SAMPLE = ['Alex P.', 'Casey R.', 'Jamie L.', 'Morgan S.', 'Riley T.', 'Quinn B.', 'Dana W.', 'Sky H.'];

const path = (store: string) => `/api/stores/${encodeURIComponent(store)}/displays`;
const fetchPresets = (store: string) => call<{ presets: DisplayPreset[] }>(path(store));

interface Draft {
  id: string | null;
  name: string;
  options: DisplayOptions & { room: DisplayRoom };
}

const blank = (): Draft => ({
  id: null,
  name: '',
  options: { ...DEFAULT_DISPLAY, room: defaultRoom(), scale: roomScale(defaultRoom()) }
});
const draftOf = (preset: DisplayPreset): Draft => ({
  id: preset.id,
  name: preset.name,
  options: { ...preset.options, room: preset.options.room ?? defaultRoom() }
});
const percent = (scale: number) => `${Math.round(scale * 100)}%`;
const nudged = (scale: number, by: number) =>
  Math.max(SCALE_LIMITS.min, Math.min(SCALE_LIMITS.max, Math.round((scale + by) * 100) / 100));

/** The screen as the room will see it: a few rows of pairings at the preset's text size. */
function Preview(props: { options: DisplayOptions; name: string }) {
  const columns = () => Math.max(1, Math.min(3, Math.floor(3.3 / props.options.scale)));
  const rows = () => Math.max(2, Math.floor(10 / props.options.scale));
  const shown = () => Array.from({ length: columns() * rows() }, (_, i) => i);
  return (
    <div class='tm-display-preview' style={{ '--tm-preview-scale': props.options.scale }} aria-hidden='true'>
      <p class='tm-display-preview-head'>{props.name || t('Big screen')}</p>
      <ol style={{ 'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))` }}>
        <For each={shown()}>
          {i => (
            <li>
              <span>
                {SAMPLE[(i * 2) % SAMPLE.length]} <small>vs {SAMPLE[(i * 2 + 1) % SAMPLE.length]}</small>
              </span>
              <strong class='num'>{i + 1}</strong>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}

function RoomInput(props: {
  id: string;
  value: number;
  limits: { min: number; max: number };
  /** Tenths, for metres; whole numbers otherwise. */
  tenths?: boolean;
  onInput: (n: number) => void;
}) {
  return (
    <input
      id={props.id}
      class='tm-input tm-set-minutes'
      type='number'
      inputmode={props.tenths ? 'decimal' : 'numeric'}
      step={props.tenths ? 0.1 : 1}
      min={props.limits.min}
      max={props.limits.max}
      value={props.value}
      onInput={e => props.onInput(Number(e.currentTarget.value))}
    />
  );
}

/** Whether the room's numbers are in reach, so the size can be worked out from them. */
const roomOk = (room: DisplayRoom) => roomInReach(room);

/**
 * How far back the farthest player sits, in the unit the reader counts in: as
 * measured when the units agree, else converted, to whole feet or a tenth of
 * a metre.
 */
function distanceIn(room: DisplayRoom, feet: boolean): number {
  if (feet) {
    return room.feet ?? Math.round(roomFeet(room));
  }
  return room.metres ?? Math.round((roomFeet(room) / FEET_PER_METRE) * 10) / 10;
}

function PresetFields(props: { draft: Draft; onChange: (draft: Draft) => void }) {
  const set = (options: Partial<Draft['options']>) =>
    props.onChange({ ...props.draft, options: { ...props.draft.options, ...options } });
  const setRoom = (next: DisplayRoom) => set(roomOk(next) ? { room: next, scale: roomScale(next) } : { room: next });
  const options = () => props.draft.options;
  const feet = measuresInFeet();
  const setDistance = (distance: number) =>
    setRoom(
      feet ? { inches: options().room.inches, feet: distance } : { inches: options().room.inches, metres: distance }
    );
  return (
    <>
      <SettingRow label={t('Name')} for='display-name'>
        <input
          id='display-name'
          class='tm-input'
          maxlength='80'
          value={props.draft.name}
          onInput={e => props.onChange({ ...props.draft, name: e.currentTarget.value })}
        />
      </SettingRow>
      <SettingRow label={t('Screen size')} for='display-inches'>
        <span class='tm-set-inline'>
          <RoomInput
            id='display-inches'
            value={options().room.inches}
            limits={ROOM_LIMITS.inches}
            onInput={inches => setRoom({ ...options().room, inches })}
          />
          <span class='muted'>{t('in diagonal')}</span>
        </span>
      </SettingRow>
      <SettingRow label={t('Farthest viewer')} for='display-distance'>
        <span class='tm-set-inline'>
          <RoomInput
            id='display-distance'
            value={distanceIn(options().room, feet)}
            limits={feet ? ROOM_LIMITS.feet : ROOM_LIMITS.metres}
            tenths={!feet}
            onInput={setDistance}
          />
          <span class='muted'>{feet ? t('ft away') : t('m away')}</span>
        </span>
      </SettingRow>
      <SettingRow label={t('Text size')}>
        <span class='tm-set-inline'>
          <button
            type='button'
            class='btn btn-secondary tm-small tm-display-step'
            aria-label={t('Smaller text')}
            onClick={() => set({ scale: nudged(options().scale, -0.05) })}
          >
            −
          </button>
          <strong class='num' aria-live='polite'>
            {percent(options().scale)}
          </strong>
          <button
            type='button'
            class='btn btn-secondary tm-small tm-display-step'
            aria-label={t('Larger text')}
            onClick={() => set({ scale: nudged(options().scale, 0.05) })}
          >
            +
          </button>
          <Show when={roomOk(options().room) && options().scale !== roomScale(options().room)}>
            <span class='muted'>
              {t('from {percent} for this room', { percent: percent(roomScale(options().room)) })}
            </span>
          </Show>
        </span>
      </SettingRow>
      <SettingRow label={t('Layout')} for='display-layout'>
        <select
          id='display-layout'
          class='tm-select'
          value={options().layout}
          onChange={e => set({ layout: e.currentTarget.value as DisplayLayout })}
        >
          <For each={Object.entries(LAYOUT_WORDS)}>{([value, label]) => <option value={value}>{t(label)}</option>}</For>
        </select>
      </SettingRow>
      <SettingRow label={t('Page timing')} for='display-timing'>
        <select
          id='display-timing'
          class='tm-select'
          value={options().pageSeconds}
          disabled={options().layout === 'faceoff'}
          onChange={e => set({ pageSeconds: Number(e.currentTarget.value) })}
        >
          <For each={TIMINGS}>
            {seconds => (
              <option value={seconds}>{seconds ? tn(seconds, '{n} second', '{n} seconds') : t('Manual')}</option>
            )}
          </For>
        </select>
      </SettingRow>
    </>
  );
}

const problem = (draft: Draft) => {
  if (!draft.name.trim()) {
    return t('Name the preset');
  }
  if (roomOk(draft.options.room)) {
    return null;
  }
  return measuresInFeet() ? t('Give whole inches and feet') : t('Give whole inches, and metres to a tenth');
};

const deleteQuestion = (name: string | undefined) => (name ? t('Delete {name}?', { name }) : t('Delete this preset?'));

export function StoreDisplays(props: { storeId: string }) {
  const [read, { mutate }] = createResource(() => props.storeId, fetchPresets);
  const presets = () => latestValue(read)?.presets ?? [];
  const [draft, setDraft] = createSignal<Draft>(blank());
  const save = createAction();
  // Which opening of the editor the draft belongs to: a new preset has no ID to tell one from the next.
  let opening = 0;
  const pick = (id: string) => {
    const preset = presets().find(item => item.id === id);
    opening += 1;
    setDraft(preset ? draftOf(preset) : blank());
    save.clear();
  };
  const openedWith = () => presets().find(item => item.id === draft().id);
  const dirty = () => JSON.stringify(draft()) !== JSON.stringify(openedWith() ? draftOf(openedWith()!) : blank());
  /**
   * Saves `sent` and opens the preset as saved. Edits made while it was on its way stay, now of the
   * saved preset, and another preset picked or started meanwhile stays as it is.
   */
  async function send(sent: Draft) {
    const { id, name, options } = sent;
    const from = opening;
    const where = path(props.storeId);
    const answer = await save.run(() =>
      call<{ preset: DisplayPreset }>(where, json('PUT', { ...(id ? { id } : {}), name: name.trim(), options }))
    );
    if (answer) {
      const { preset } = answer;
      mutate(prev => ({
        presets: [...(prev?.presets ?? []).filter(item => item.id !== preset.id), preset].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      }));
      if (opening === from) {
        setDraft(now => (now === sent ? draftOf(preset) : { ...now, id: preset.id }));
      }
    }
  }
  function submit(event: Event) {
    event.preventDefault();
    void send(draft());
  }
  /** Deletes a preset; the editor gives way to a new one if it had that preset open. */
  async function remove(id: string) {
    const where = `${path(props.storeId)}?preset=${encodeURIComponent(id)}`;
    if (await save.run(() => call<object>(where, { method: 'DELETE' }))) {
      mutate(prev => ({ presets: (prev?.presets ?? []).filter(item => item.id !== id) }));
      if (draft().id === id) {
        opening += 1;
        setDraft(blank());
      }
      save.clear();
    }
  }
  return (
    <Show when={read.state !== 'pending' || latestValue(read)} fallback={<Skeleton height='240px' />}>
      <form
        class='tm-store-section tm-display-presets'
        aria-labelledby='store-displays-head'
        noValidate
        onSubmit={submit}
      >
        <h2 class='tm-subhead tm-box-head' id='store-displays-head'>
          {t('Display presets')}
        </h2>
        <ErrorLine message={read.error ? errorText(read.error) : null} />
        <div class='tm-set-inline'>
          <Show when={presets().length}>
            <Segmented
              options={presets().map(preset => ({ value: preset.id, label: preset.name }))}
              selected={draft().id ?? ''}
              onSelect={pick}
              ariaLabel={t('Preset')}
            />
          </Show>
          <button
            type='button'
            class='btn btn-secondary'
            aria-pressed={draft().id === null}
            disabled={presets().length >= MAX_DISPLAY_PRESETS}
            onClick={() => pick('')}
          >
            {t('New preset')}
          </button>
        </div>
        <div class='tm-display-editor'>
          <div class='tm-box tm-set-box'>
            <PresetFields draft={draft()} onChange={setDraft} />
          </div>
          <Preview options={draft().options} name={draft().name} />
        </div>
        <SaveBar dirty={dirty()} busy={save.busy()} saved={save.saved()} error={save.error()} reason={problem(draft())}>
          <Show when={draft().id}>
            {id => (
              <ConfirmAction
                label={t('Delete')}
                question={deleteQuestion(openedWith()?.name)}
                confirmLabel={t('Delete')}
                class='btn btn-secondary'
                danger
                disabled={save.busy()}
                onConfirm={() => void remove(id())}
              />
            )}
          </Show>
        </SaveBar>
      </form>
    </Show>
  );
}
