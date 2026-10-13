/**
 * PUT /api/tournaments/:code/settings — staff change the event's settings
 * (see TournamentSettings). Showing decks sooner than the event does now is
 * the organizer's call alone: a staff member could otherwise reveal every
 * player's deck mid-event and hide them again. Only the event of a store with
 * a league becomes sanctioned, and a Community organizer's event moved to another date takes
 * that date only while they hold no other event on it.
 */

import {
  type DeckVisibility,
  readSettings,
  sanctionedSettingsError,
  type TournamentSettings
} from '../../../../shared/tournament/view.js';
import { applyLifecycleOperation } from '../../../../shared/tournament/lifecycle.js';
import { lifecycleDocument } from '../../../../shared/tournament/lifecycleImport.js';
import { commandContext } from '../../../lib/tournaments/commandContext.js';
import type { D1Like } from '../../../lib/types.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openForStaff } from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { dayChange, mutate, type TournamentRow } from '../../../lib/tournaments/store.js';

/** How soon each setting shows decks to players: higher is sooner. */
const OPENNESS: Record<DeckVisibility, number> = { off: 0, after: 1, always: 2 };

/**
 * Whether the row's event may become sanctioned: it is a store's, and the
 * store has its league. Asked of the database only when `change` turns it on.
 */
async function maySanction(db: D1Like, row: TournamentRow, change: unknown): Promise<boolean> {
  const turnsOn = !row.settings.sanctioned && readSettings(change, row.settings)?.sanctioned;
  if (row.storeId === null || !turnsOn) {
    return row.storeId !== null;
  }
  const store = await db.prepare('SELECT league_id FROM stores WHERE id = ?').bind(row.storeId).first<{
    league_id: string | null;
  }>();
  return Boolean(store?.league_id);
}

/** The settings `change` makes of the row's, or why it cannot make them. */
function changedSettings(change: unknown, row: TournamentRow, sanctionable: boolean): TournamentSettings | string {
  const next = readSettings(change, row.settings);
  if (!next) {
    return 'Not a settings change';
  }
  if (next.sanctioned && !row.settings.sanctioned && !sanctionable) {
    return row.storeId === null
      ? 'Only a store runs sanctioned events'
      : 'An unsanctioned store runs unsanctioned events only';
  }
  const invalid =
    row.mode === 'swiss' ? sanctionedSettingsError(change as object, row.settings, next, row.tournament.info) : null;
  return invalid ?? { ...next, idle: false };
}

/** An early Prerelease conclusion acknowledges standings at stage 8 (SPEC 3.6). */
function concludedPrerelease(row: TournamentRow, settings: TournamentSettings) {
  const tournament = lifecycleDocument(row.tournament);
  if (
    row.mode !== 'swiss' ||
    settings.finished === row.settings.finished ||
    tournament.settings?.mode !== 'PRERELEASE'
  ) {
    return {};
  }
  if (!settings.finished) {
    return {
      tournament: {
        ...tournament,
        settings: { ...tournament.settings, stage: 4 as const },
        pods: tournament.pods.map(({ prereleaseConcluded: _ended, ...pod }) => pod)
      }
    };
  }
  const ctx = commandContext(tournament, undefined, settings.sanctioned);
  const finished = applyLifecycleOperation(tournament, { type: 'finish' }, ctx);
  return finished.ok ? { tournament: finished.tournament } : finished.error!;
}

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const body = await readJsonBody(context.request, 4096);
  const change = body.ok ? body.value : null;
  const sanctionable = await maySanction(access.db, access.row, change);
  const next = changedSettings(change, access.row, sanctionable);
  if (typeof next === 'string') {
    return jsonError(next, 400);
  }
  if (access.role !== 'owner' && OPENNESS[next.deckVisibility] > OPENNESS[access.row.settings.deckVisibility]) {
    return jsonError('Only the organizer can show decks sooner', 403);
  }
  const outcome = await mutate(access.db, access.row, row => {
    const settings = changedSettings(change, row, sanctionable);
    if (typeof settings === 'string') {
      return settings;
    }
    const conclusion = concludedPrerelease(row, settings);
    return typeof conclusion === 'string' ? conclusion : { settings, ...dayChange(row, settings), ...conclusion };
  });
  return answerStaff(context, access, outcome);
}
