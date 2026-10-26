/**
 * PUT /api/tournaments/:code/sync — the latest .tdf of a TOM-run event, as
 * the organizer's browser parsed it: { tournament, base }, where `base` is the
 * revision (shared/tournament/revision.ts) of the copy that browser last sent
 * or loaded.
 *
 * This is the fix for re-uploading: the browser watches the file TOM saves,
 * parses it locally, and sends the result only when it changed. Storing it is
 * one validated write, with nothing to reprocess. Pending results the new
 * file settles are dropped. The answer is the console's new copy of the
 * event, with the revision it now holds, so the console need not ask again. A file sent from a copy the site no longer holds
 * is refused (409) rather than taken over rounds another browser synced; one
 * that is the copy the site already holds changes nothing and succeeds,
 * apart from an upload the organizer chose ({ manual: true }), which records
 * the import time.
 *
 * An ended event takes no new copy until it is reopened: its results stand
 * as they were when it ended.
 *
 * The file's round clocks are set aside for the ones the site runs (see
 * shared/tournament/tomClock.ts), so a copy that differs only in its clocks
 * is the copy the site holds.
 */

import { revisionOf } from '../../../../shared/tournament/revision.js';
import { withoutClocks, withSiteClocks } from '../../../../shared/tournament/tomClock.js';
import type { Tournament } from '../../../../shared/tournament/types.js';
import { readTournament } from '../../../../shared/tournament/validate.js';
import { prunePending } from '../../../../shared/tournament/view.js';
import { asObject, readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import {
  changeEvent,
  manageView,
  MAX_TOURNAMENT_BYTES,
  openForStaff,
  privateJson,
  type StaffAccess
} from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { FINISHED_REFUSAL } from '../../../lib/tournaments/results.js';
import { msg } from '../../../../shared/i18n.js';

const CONFLICT = msg('The site has a different copy of this event. Reconnect the file TOM is using to replace it.');

interface Upload {
  tournament: Tournament;
  base: string;
  /** The organizer chose this file, rather than the console following one: it is an import even unchanged. */
  manual: boolean;
}

/** The upload in a request body, or the refusal. */
async function readUpload(request: Request): Promise<Upload | Response> {
  const body = await readJsonBody(request, MAX_TOURNAMENT_BYTES);
  if (!body.ok) {
    return jsonError('That file is too large', 413);
  }
  const value = asObject(body.value) ?? {};
  const tournament = readTournament(value.tournament);
  if (!tournament) {
    return jsonError('That file did not read as a tournament', 400);
  }
  return typeof value.base === 'string'
    ? { tournament, base: value.base, manual: value.manual === true }
    : jsonError('Reload the page', 400);
}

/** An explicit upload of the copy the site already holds: only the import time changes. */
async function importedAgain(context: Context<'code'>, access: StaffAccess, revision: string): Promise<Response> {
  const outcome = await changeEvent(access, () => ({ lastImportAt: Date.now() }));
  return answerStaff(context, access, outcome, { revision });
}

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  if (access.row.mode !== 'tom') {
    return jsonError('This event is run on the site, not in TOM', 400);
  }
  const upload = await readUpload(context.request);
  if (upload instanceof Response) {
    return upload;
  }
  const held = await revisionOf(access.row.tournament);
  const sent = await revisionOf(upload.tournament);
  // The copy the site already holds, from a second tab or a push that crossed another: nothing to change,
  // unless the organizer chose the file, which is an import whatever it holds.
  if (sent === held) {
    return upload.manual
      ? importedAgain(context, access, held)
      : privateJson({ ...manageView(access), revision: held });
  }
  if (held !== upload.base) {
    return jsonError(CONFLICT, 409);
  }
  const { tournament } = upload;
  if (tournament.players.length === 0 && access.row.tournament.players.length > 0) {
    return jsonError('That file has nobody in it; link the file TOM is using', 400);
  }
  // Besides a sync, only the clock changes a TOM event's document, so a retry after another write finds the copy checked.
  const unclocked = (held: Tournament) => JSON.stringify(withoutClocks(held));
  const checked = unclocked(access.row.tournament);
  // Judged on each try's own read, so an end that lands between the read and the write still holds.
  const outcome = await changeEvent(access, row => {
    if (row.settings.finished) {
      return FINISHED_REFUSAL;
    }
    return row === access.row || unclocked(row.tournament) === checked
      ? {
          tournament: withSiteClocks(tournament, row.tournament),
          pending: prunePending(tournament, row.pending),
          lastImportAt: Date.now()
        }
      : { error: CONFLICT, status: 409 };
  });
  return answerStaff(context, access, outcome, { revision: sent });
}
