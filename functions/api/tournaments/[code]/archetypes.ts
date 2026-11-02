/**
 * POST /api/tournaments/:code/archetypes — staff name every pasted list again
 * by the archetype rules as they stand now (see archetypeRules.ts), for lists
 * sent before the rules changed. A name staff gave a player stays theirs (see
 * shownDecks). A paper list has nothing to read, and neither does a list
 * whose cards went as the event ended (see store.ts): both keep the name they
 * have. Answers with the console's copy of the event and how many lists were
 * renamed.
 */

import { archetypeOfList } from '../../../../shared/tournament/archetypes.js';
import { decksEnabled } from '../../../../shared/tournament/view.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { changeEvent, openForStaff } from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { archetypeRules } from '../../../lib/tournaments/archetypeRules.js';
import { inferredFrom } from '../../../lib/tournaments/registrations.js';
import { changesNothing } from '../../../lib/tournaments/store.js';
import { msg } from '../../../../shared/i18n.js';

interface ListRow {
  user_id: string;
  pop_id: string;
  first_name: string;
  last_name: string;
  deck: string;
  deck_mode: string;
  archetype: string | null;
}

/** The name the list's cards give it now, or the one it has when there are no cards to read. */
const reread = (list: ListRow, read: (deck: string) => string | null): string | null =>
  list.deck_mode === 'digital' && list.deck.trim() ? read(list.deck) : list.archetype;

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  if (!decksEnabled(access.row.settings)) {
    return jsonError(msg('Archetypes are off for this event'), 400);
  }
  const rules = await archetypeRules();
  // Without rules every list would read as nobody's, and lose the name it has.
  if (rules.length === 0) {
    return jsonError(msg('Couldn’t read the archetype rules. Try again later.'), 503);
  }
  const { results } = await access.db
    .prepare('SELECT user_id, pop_id, first_name, last_name, deck, deck_mode, archetype FROM decklists WHERE code = ?')
    .bind(access.row.code)
    .all<ListRow>();
  const lists = results.map(list => ({ list, archetype: reread(list, deck => archetypeOfList(deck, rules)) }));
  const renamed = lists.filter(({ list, archetype }) => archetype !== list.archetype);
  const shown = lists.map(({ list, archetype }) => ({
    popId: list.pop_id,
    firstName: list.first_name,
    lastName: list.last_name,
    archetype
  }));
  // The event's names first: that write holds only while the asker is still on staff, and the lists follow it.
  const outcome = await changeEvent(access, row => {
    const inferredDecks = inferredFrom(row, shown);
    return changesNothing(row, row.inferredDecks, inferredDecks) ? {} : { inferredDecks };
  });
  if (!('error' in outcome) && renamed.length) {
    // Each only while its list is still the one read, so a list replaced meanwhile keeps the name it came in with.
    await access.db.batch(
      renamed.map(({ list, archetype }) =>
        access.db
          .prepare('UPDATE decklists SET archetype = ? WHERE code = ? AND user_id = ? AND deck = ?')
          .bind(archetype, access.row.code, list.user_id, list.deck)
      )
    );
  }
  return answerStaff(context, access, outcome, { renamed: renamed.length });
}
