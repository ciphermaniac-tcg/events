/** Store-owned display presets and the immutable copy an event chooses. */
export type DisplayLayout = 'auto' | 'faceoff' | 'tables' | 'alphabetical';

/** The screen a preset was made for: its diagonal, and how far back the farthest player reads it. */
export interface DisplayRoom {
  inches: number;
  feet: number;
}

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

export const DEFAULT_DISPLAY: DisplayOptions = { scale: 1, layout: 'auto', pageSeconds: 15 };
export const MAX_DISPLAY_PRESETS = 20;
export const SCALE_LIMITS = { min: 0.75, max: 2 } as const;
export const ROOM_LIMITS = { inches: { min: 20, max: 300 }, feet: { min: 3, max: 150 } } as const;
const LAYOUTS: readonly DisplayLayout[] = ['auto', 'faceoff', 'tables', 'alphabetical'];

const within = (value: unknown, limits: { min: number; max: number }, whole = false): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= limits.min &&
  value <= limits.max &&
  (!whole || Number.isInteger(value));

function readRoom(value: unknown): DisplayRoom | null {
  const { inches, feet } = (value ?? {}) as Record<string, unknown>;
  return within(inches, ROOM_LIMITS.inches, true) && within(feet, ROOM_LIMITS.feet, true) ? { inches, feet } : null;
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
