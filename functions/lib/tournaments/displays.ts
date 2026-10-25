/**
 * A store's edited display preset, carried into the copy each of the store's
 * unfinished events holds of it, so a screen mid-event shows the edit at its
 * next poll. An ended event keeps the screen it ended with, and one whose
 * preset was deleted keeps its last copy. Following the store is no change
 * of the event's own, so its idle clock runs on.
 */

import type { DisplayPreset, DisplaySelection } from '../../../shared/tournament/display.js';
import type { Context } from '../auth/env.js';
import type { D1Like } from '../types.js';
import { publishAfter } from './publish.js';
import { type Change, changesNothing, loadTournament, mutate } from './store.js';

const holding = (storeId: string, preset: DisplayPreset): Change => {
  const display: DisplaySelection = { ...preset, storeId };
  return row => {
    const held = row.settings.display;
    if (row.settings.finished || held?.id !== preset.id || held.storeId !== storeId) {
      return {};
    }
    return changesNothing(row, held, display)
      ? {}
      : { settings: { ...row.settings, display }, updatedAt: row.updatedAt };
  };
};

export async function followPreset(
  context: Pick<Context, 'env' | 'waitUntil'>,
  db: D1Like,
  storeId: string,
  preset: DisplayPreset
): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT code FROM tournaments WHERE store_id = ?1 AND coalesce(json_extract(settings, '$.finished'), 0) = 0 " +
        "AND json_extract(settings, '$.display.id') = ?2 AND json_extract(settings, '$.display.storeId') = ?1"
    )
    .bind(storeId, preset.id)
    .all<{ code: string }>();
  const change = holding(storeId, preset);
  for (const { code } of results) {
    const row = await loadTournament(db, code);
    const outcome = row && (await mutate(db, row, change));
    if (outcome && 'row' in outcome && outcome.row.version !== row.version) {
      await publishAfter(context, outcome.row);
    }
  }
}
