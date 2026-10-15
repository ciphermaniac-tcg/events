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
  MAX_DISPLAY_PRESETS,
  ROOM_LIMITS,
  SCALE_LIMITS
} from '../../../shared/tournament/display';
import { Segmented } from '../../components/Segmented';
import { Skeleton } from '../../components/Skeleton';
import { call, errorText, json } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { ConfirmAction } from './ConfirmAction';
import { roomScale } from './displayLayout';
import { ErrorLine } from './Field';
import { createSave, SaveBar } from './StoreSave';
import { SettingRow } from './SettingControls';

const LAYOUT_WORDS: Record<DisplayLayout, string> = {
  auto: 'Automatic',
  faceoff: 'Face-off scroll',
  tables: 'Table pages',
  alphabetical: 'Alphabetical pages'
};
const TIMINGS = [0, 10, 15, 20, 30] as const;
const DEFAULT_ROOM: DisplayRoom = { inches: 55, feet: 15 };
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
  options: { ...DEFAULT_DISPLAY, room: DEFAULT_ROOM, scale: roomScale(DEFAULT_ROOM) }
});
const draftOf = (preset: DisplayPreset): Draft => ({
  id: preset.id,
  name: preset.name,
  options: { ...preset.options, room: preset.options.room ?? DEFAULT_ROOM }
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
      <p class='tm-display-preview-head'>{props.name || 'Big screen'}</p>
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
  onInput: (n: number) => void;
}) {
  return (
    <input
      id={props.id}
      class='tm-input tm-set-minutes'
      type='number'
      inputmode='numeric'
      min={props.limits.min}
      max={props.limits.max}
      value={props.value}
      onInput={e => props.onInput(Number(e.currentTarget.value))}
    />
  );
}

const whole = (value: number, limits: { min: number; max: number }) =>
  Number.isInteger(value) && value >= limits.min && value <= limits.max;
/** Whether the room's numbers are whole and in reach, so the size can be worked out from them. */
const roomOk = (room: DisplayRoom) => whole(room.inches, ROOM_LIMITS.inches) && whole(room.feet, ROOM_LIMITS.feet);

function PresetFields(props: { draft: Draft; onChange: (draft: Draft) => void }) {
  const set = (options: Partial<Draft['options']>) =>
    props.onChange({ ...props.draft, options: { ...props.draft.options, ...options } });
  const setRoom = (room: Partial<DisplayRoom>) => {
    const next = { ...props.draft.options.room, ...room };
    set(roomOk(next) ? { room: next, scale: roomScale(next) } : { room: next });
  };
  const options = () => props.draft.options;
  return (
    <>
      <SettingRow label='Name' for='display-name'>
        <input
          id='display-name'
          class='tm-input'
          maxlength='80'
          value={props.draft.name}
          onInput={e => props.onChange({ ...props.draft, name: e.currentTarget.value })}
        />
      </SettingRow>
      <SettingRow label='Screen size' for='display-inches'>
        <span class='tm-set-inline'>
          <RoomInput
            id='display-inches'
            value={options().room.inches}
            limits={ROOM_LIMITS.inches}
            onInput={inches => setRoom({ inches })}
          />
          <span class='muted'>in diagonal</span>
        </span>
      </SettingRow>
      <SettingRow label='Farthest viewer' for='display-feet'>
        <span class='tm-set-inline'>
          <RoomInput
            id='display-feet'
            value={options().room.feet}
            limits={ROOM_LIMITS.feet}
            onInput={feet => setRoom({ feet })}
          />
          <span class='muted'>ft away</span>
        </span>
      </SettingRow>
      <SettingRow label='Text size'>
        <span class='tm-set-inline'>
          <button
            type='button'
            class='btn btn-secondary tm-small tm-display-step'
            aria-label='Smaller text'
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
            aria-label='Larger text'
            onClick={() => set({ scale: nudged(options().scale, 0.05) })}
          >
            +
          </button>
          <Show when={roomOk(options().room) && options().scale !== roomScale(options().room)}>
            <span class='muted'>from {percent(roomScale(options().room))} for this room</span>
          </Show>
        </span>
      </SettingRow>
      <SettingRow label='Layout' for='display-layout'>
        <select
          id='display-layout'
          class='tm-select'
          value={options().layout}
          onChange={e => set({ layout: e.currentTarget.value as DisplayLayout })}
        >
          <For each={Object.entries(LAYOUT_WORDS)}>{([value, label]) => <option value={value}>{label}</option>}</For>
        </select>
      </SettingRow>
      <SettingRow label='Page timing' for='display-timing'>
        <select
          id='display-timing'
          class='tm-select'
          value={options().pageSeconds}
          disabled={options().layout === 'faceoff'}
          onChange={e => set({ pageSeconds: Number(e.currentTarget.value) })}
        >
          <For each={TIMINGS}>
            {seconds => <option value={seconds}>{seconds ? `${seconds} seconds` : 'Manual'}</option>}
          </For>
        </select>
      </SettingRow>
    </>
  );
}

const problem = (draft: Draft) => {
  if (!draft.name.trim()) {
    return 'Name the preset';
  }
  return roomOk(draft.options.room) ? null : 'Give whole inches and feet';
};

export function StoreDisplays(props: { storeId: string }) {
  const [read, { mutate }] = createResource(() => props.storeId, fetchPresets);
  const presets = () => latestValue(read)?.presets ?? [];
  const [draft, setDraft] = createSignal<Draft>(blank());
  const save = createSave();
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
          Display presets
        </h2>
        <ErrorLine message={read.error ? errorText(read.error) : null} />
        <div class='tm-set-inline'>
          <Show when={presets().length}>
            <Segmented
              options={presets().map(preset => ({ value: preset.id, label: preset.name }))}
              selected={draft().id ?? ''}
              onSelect={pick}
              ariaLabel='Preset'
            />
          </Show>
          <button
            type='button'
            class='btn btn-secondary'
            aria-pressed={draft().id === null}
            disabled={presets().length >= MAX_DISPLAY_PRESETS}
            onClick={() => pick('')}
          >
            New preset
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
                label='Delete'
                question={`Delete ${openedWith()?.name ?? 'this preset'}?`}
                confirmLabel='Delete'
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
