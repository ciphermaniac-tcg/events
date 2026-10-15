import { readDisplayPreset } from '../../../../shared/tournament/display.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openStore } from '../../../lib/stores/access.js';
import { deleteDisplayPreset, displayPresets, saveDisplayPreset } from '../../../lib/stores/displayPresets.js';
import { privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestGet(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'member');
  return access instanceof Response
    ? access
    : privateJson({ presets: await displayPresets(access.db, access.store.id) });
}

export async function onRequestPut(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'manager');
  if (access instanceof Response) {
    return access;
  }
  const body = await readJsonObject(context.request, 2048);
  const read = readDisplayPreset(body);
  const id = body?.id;
  if (!read || (id !== undefined && (typeof id !== 'string' || id.length > 64))) {
    return jsonError('Check the display preset', 400);
  }
  const preset = { ...read, id: typeof id === 'string' ? id : crypto.randomUUID() };
  try {
    const saved = await saveDisplayPreset(access.db, access.store.id, preset, {
      guard: access.guard('manager'),
      creating: id === undefined
    });
    return saved ? privateJson({ preset }) : jsonError('Preset unavailable or store preset limit reached', 409);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return jsonError('Another preset has that name. Please pick another.', 409);
    }
    throw error;
  }
}

export async function onRequestDelete(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'manager');
  if (access instanceof Response) {
    return access;
  }
  const id = new URL(context.request.url).searchParams.get('preset') ?? '';
  const removed = await deleteDisplayPreset(access.db, access.store.id, id, access.guard('manager'));
  return removed ? privateJson({ removed: id }) : jsonError('Preset unavailable', 409);
}
