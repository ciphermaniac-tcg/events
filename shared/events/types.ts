/**
 * Event locator artifacts: the shapes the producer writes to R2 and the browser
 * reads back.
 *
 * Everything lives under `events/v1/`. The version is in the path rather than
 * the payload so a future format can ship beside this one: a tab that loaded
 * the old bundle keeps reading the old files until it reloads.
 *
 * Listings are sharded into fixed latitude/longitude cells (see ./cells) so a
 * visitor downloads the few cells their search circle touches, not the world.
 * @module shared/events/types
 */

export type EventKind = 'cup' | 'challenge' | 'prerelease' | 'local';
