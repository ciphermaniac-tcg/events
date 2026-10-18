/**
 * The physics of a drifting row the reader can grab and throw (the home
 * page's features): an offset that wraps around one copy of the row, and a
 * speed that eases back to the drift after a throw.
 * @module src/lib/reel
 */

/** The fastest a throw may send a row, in pixels a second. */
export const MAX_THROW = 4000;

/** How much of a throw's extra speed is left after one second. */
const KEEP_PER_SECOND = 0.04;

/** A pointer move while dragging: how far it went, and over how long. */
export interface DragSample {
  dx: number;
  ms: number;
}

/** `x` brought into [0, width), so a row can run forever over repeated copies. */
export function wrapOffset(x: number, width: number): number {
  return width > 0 ? ((x % width) + width) % width : 0;
}

/** The speed `seconds` later: the part above the drift dies away, quickly at first. */
export function coast(speed: number, drift: number, seconds: number): number {
  return drift + (speed - drift) * KEEP_PER_SECOND ** seconds;
}

/**
 * The speed a release throws the row at, from the last few moves: none when
 * the pointer had stopped before letting go. A move to the left throws the
 * row forward, the way its offset grows.
 */
export function throwSpeed(samples: readonly DragSample[], msSinceLastMove: number): number {
  const ms = samples.reduce((sum, sample) => sum + sample.ms, 0);
  if (msSinceLastMove > 80 || ms <= 0) {
    return 0;
  }
  const dx = samples.reduce((sum, sample) => sum + sample.dx, 0);
  return Math.max(-MAX_THROW, Math.min(MAX_THROW, (-dx / ms) * 1000));
}
