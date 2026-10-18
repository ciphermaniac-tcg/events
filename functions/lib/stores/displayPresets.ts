import { type DisplayPreset, MAX_DISPLAY_PRESETS } from '../../../shared/tournament/display.js';
import { type Guard, rowsChanged } from '../d1.js';
import type { D1Like } from '../types.js';

export async function displayPresets(db: D1Like, storeId: string): Promise<DisplayPreset[]> {
  const { results } = await db
    .prepare('SELECT id, name, options FROM display_presets WHERE store_id = ? ORDER BY name')
    .bind(storeId)
    .all<{ id: string; name: string; options: string }>();
  return (results ?? []).map(row => ({ ...row, options: JSON.parse(row.options) as DisplayPreset['options'] }));
}

export async function saveDisplayPreset(
  db: D1Like,
  storeId: string,
  preset: DisplayPreset,
  options: { guard: Guard; creating: boolean }
): Promise<boolean> {
  const { guard, creating } = options;
  const query = creating
    ? 'INSERT INTO display_presets (store_id, id, name, options) SELECT ?, ?, ?, ? ' +
      `WHERE (SELECT COUNT(*) FROM display_presets WHERE store_id = ?) < ${MAX_DISPLAY_PRESETS} AND (${guard.sql})`
    : `UPDATE display_presets SET name = ?, options = ? WHERE store_id = ? AND id = ? AND (${guard.sql})`;
  const data = [preset.name, JSON.stringify(preset.options)];
  const values = creating ? [storeId, preset.id, ...data, storeId] : [...data, storeId, preset.id];
  const result = await db
    .prepare(query)
    .bind(...values, ...guard.values)
    .run();
  return rowsChanged(result) > 0;
}

export async function deleteDisplayPreset(db: D1Like, storeId: string, id: string, guard: Guard): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM display_presets WHERE store_id = ? AND id = ? AND (${guard.sql})`)
    .bind(storeId, id, ...guard.values)
    .run();
  return rowsChanged(result) > 0;
}
