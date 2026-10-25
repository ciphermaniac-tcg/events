/**
 * Store-owned display presets and the copy an event chooses, which follows
 * the store's edits while the event runs (functions/lib/tournaments/displays.ts).
 * 'auto' is no longer offered; presets saved with it scroll, like 'faceoff'.
 */
export type DisplayLayout = 'auto' | 'faceoff' | 'tables' | 'alphabetical';

/**
 * The screen a preset was made for: its diagonal, which screens are sold by in
 * inches the world over, and how far back the farthest player reads it, in
 * whole feet or in metres to a tenth, as whoever measured the room counts.
 */
export type DisplayRoom = { inches: number } & ({ feet: number; metres?: never } | { metres: number; feet?: never });

export interface DisplayOptions {
  /** Multiplier over automatic viewport sizing; CSS pixels already incorporate device DPI. */
  scale: number;
  layout: DisplayLayout;
  /** Seconds per page, or 0 for manual movement. */
  pageSeconds: number;
  /** What the scale was worked out from, when the preset was made from the room. */
  room?: DisplayRoom;
}

export interface DisplayPreset {
  id: string;
  name: string;
  options: DisplayOptions;
}

export interface DisplaySelection extends DisplayPreset {
  /** Store that supplied this snapshot. */
  storeId: string;
}

export const DEFAULT_DISPLAY: DisplayOptions = { scale: 1, layout: 'faceoff', pageSeconds: 15 };
export const MAX_DISPLAY_PRESETS = 20;
export const SCALE_LIMITS = { min: 0.75, max: 2 } as const;
export const ROOM_LIMITS = {
  inches: { min: 20, max: 300 },
  feet: { min: 3, max: 150 },
  metres: { min: 1, max: 45 }
} as const;

/** Feet in a metre, for a room measured in metres. */
export const FEET_PER_METRE = 1 / 0.3048;
const LAYOUTS: readonly DisplayLayout[] = ['auto', 'faceoff', 'tables', 'alphabetical'];

const within = (value: unknown, limits: { min: number; max: number }, whole = false): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= limits.min &&
  value <= limits.max &&
  (!whole || Number.isInteger(value));

/** Metres to a tenth at most: 4.5, not 4.55. */
const tenths = (value: number) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;

/** Whether a room's numbers are in reach: whole inches, and whole feet or metres to a tenth, never both. */
export function roomInReach(room: Record<string, unknown>): room is DisplayRoom {
  const { inches, feet, metres } = room;
  if (!within(inches, ROOM_LIMITS.inches, true) || (feet !== undefined) === (metres !== undefined)) {
    return false;
  }
  return feet === undefined
    ? within(metres, ROOM_LIMITS.metres) && tenths(metres)
    : within(feet, ROOM_LIMITS.feet, true);
}

/** How far back the farthest player sits, in feet whichever way it was measured. */
export const roomFeet = (room: DisplayRoom): number => room.feet ?? room.metres * FEET_PER_METRE;

function readRoom(value: unknown): DisplayRoom | null {
  const { inches, feet, metres } = (value ?? {}) as Record<string, unknown>;
  const room = { inches, ...(feet === undefined ? {} : { feet }), ...(metres === undefined ? {} : { metres }) };
  return roomInReach(room) ? room : null;
}

export function readDisplayOptions(value: unknown): DisplayOptions | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const { scale, layout, pageSeconds, room } = value as Record<string, unknown>;
  const read = room === undefined ? undefined : readRoom(room);
  const valid =
    within(scale, SCALE_LIMITS) &&
    LAYOUTS.includes(layout as DisplayLayout) &&
    within(pageSeconds, { min: 0, max: 60 }, true) &&
    read !== null;
  return valid ? { scale, layout: layout as DisplayLayout, pageSeconds, ...(read ? { room: read } : {}) } : null;
}

export function readDisplayPreset(value: unknown): Pick<DisplayPreset, 'name' | 'options'> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const { name, options } = value as Record<string, unknown>;
  const read = readDisplayOptions(options);
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 80 && read
    ? { name: name.trim(), options: read }
    : null;
}
