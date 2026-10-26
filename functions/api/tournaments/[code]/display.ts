import type { DisplaySelection } from '../../../../shared/tournament/display.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { displayPresets } from '../../../lib/stores/displayPresets.js';
import { openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { changesNothing } from '../../../lib/tournaments/store.js';
import { staffChange } from '../../../lib/tournaments/answers.js';

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const presets = access.row.storeId ? await displayPresets(access.db, access.row.storeId) : [];
  return privateJson({ presets, selected: access.row.settings.display });
}

export function onRequestPut(context: Context<'code'>): Promise<Response> {
  return staffChange(context, async access => {
    const body = await readJsonObject(context.request, 256);
    const { storeId } = access.row;
    const presets = storeId ? await displayPresets(access.db, storeId) : [];
    const preset = presets.find(item => item.id === body?.preset);
    if (body?.preset !== null && !preset) {
      return jsonError('No such store display preset', 400);
    }
    const display: DisplaySelection | null = preset && storeId ? { ...preset, storeId } : null;
    return row =>
      changesNothing(row, row.settings.display, display) ? {} : { settings: { ...row.settings, display } };
  });
}
