/**
 * PUT /api/tournaments/:code/settings — staff change the event's settings
 * (see TournamentSettings). Showing decks sooner than the event does now is
 * the organizer's call alone: a staff member could otherwise reveal every
 * player's deck mid-event and hide them again. Only the event of a store with
 * a league becomes sanctioned, and a Community organizer's event moved to another date takes
 * that date only while they hold no other event on it.
 */

import {
  readSettings,
  type Role,
  sanctionedSettingsError,
  showsDecksSooner,
  type TournamentSettings,
  unsanctionedPlayer
} from '../../../../shared/tournament/view.js';
import { playerName } from '../../../../shared/tournament/types.js';
import { applyLifecycleOperation } from '../../../../shared/tournament/lifecycle.js';
import { lifecycleDocument } from '../../../../shared/tournament/lifecycleImport.js';
import { commandContext } from '../../../lib/tournaments/commandContext.js';
import type { D1Like } from '../../../lib/types.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { changeEvent, openForStaff } from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { type Change, changesNothing, dayChange, type TournamentRow } from '../../../lib/tournaments/store.js';
import { msg, msgf } from '../../../../shared/i18n.js';

const SOONER = msg('Only the organizer can show decks sooner');

/** Whether the settings show decks sooner than the row does, which only the organizer may. */
const showsSooner = (role: Role | null, row: TournamentRow, next: TournamentSettings) =>
  role !== 'owner' && showsDecksSooner(next.deckVisibility, row.settings.deckVisibility);

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
    return msg('Not a settings change');
  }
  // Once play starts, players can't be asked for what a sanctioned event seats them by.
  const unseated = next.sanctioned && !row.settings.sanctioned ? unsanctionedPlayer(row.tournament) : undefined;
  if (unseated) {
    return msgf(
      'Once round 1 is paired, an event is sanctioned only when every player has a Player ID and birth year. {name} is missing one.',
      { name: playerName(unseated) }
    );
  }
  if (next.sanctioned && !row.settings.sanctioned && !sanctionable) {
    return row.storeId === null
      ? msg('Only a store runs sanctioned events')
      : msg('An unsanctioned store runs unsanctioned events only');
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

/** The change `change` makes of the event's settings, as the asker's role allows. */
function settingsChange(change: unknown, sanctionable: boolean): Change {
  return (row, role): ReturnType<Change> => {
    const settings = changedSettings(change, row, sanctionable);
    if (typeof settings === 'string') {
      return settings;
    }
    if (showsSooner(role, row, settings)) {
      return { error: SOONER, status: 403 };
    }
    if (changesNothing(row, row.settings, settings)) {
      return {};
    }
    const conclusion = concludedPrerelease(row, settings);
    return typeof conclusion === 'string' ? conclusion : { settings, ...dayChange(row, settings), ...conclusion };
  };
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
  // Judged against the event as each try finds it: decks the organizer hid meanwhile are not staff's to show again.
  const outcome = await changeEvent(access, settingsChange(change, sanctionable));
  return answerStaff(context, access, outcome);
}
