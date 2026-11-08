/**
 * The demo's starting point: a demo organizer who manages a demo store, signed
 * in, and one sample event of the store's with the home page's sixteen players
 * registered, each with a real decklist (decklists.ts), waiting for its first
 * round. The account and the store go
 * straight into the database (there is no sign-in to go through); the event
 * and its players go through the functions, as the console would send them.
 */

import type { Database } from 'sql.js';
import type { TournamentEnv } from '../../functions/lib/auth/env';
import { sha256 } from '../../functions/lib/auth/session';
import { SESSION_COOKIE } from '../../functions/lib/auth/cookies';
import { setCookie } from './cookies';
import { DEMO_ENTRANTS, DEMO_LISTS } from './decklists';

type Answer = (request: Request, env: TournamentEnv) => Promise<Response>;

const ORGANIZER = 'demo-organizer';
const STORE = 'demo-store';
const DAY = 24 * 60 * 60 * 1000;
/** The players' Play! Pokémon IDs run up from here, seven digits each. */
const FIRST_ID = 1000000;

function account(db: Database, tokenHash: string, now: number): void {
  db.run(
    'INSERT INTO users (id, email, pop_id, first_name, last_name, birth_date, created_at, handle, age_checked_at) ' +
      "VALUES (?, 'demo@example.com', '9000001', 'Demo', 'Organizer', '01/01/1990', ?, 'demo', ?)",
    [ORGANIZER, now, now]
  );
  db.run(
    'INSERT INTO stores (id, league_id, status, name, address, city, region, country, time_zone, created_at, updated_at) ' +
      "VALUES (?, '900001', 'active', 'Demo Games', '1 Main St', 'Springfield', 'TX', 'US', ?, ?, ?)",
    [STORE, Intl.DateTimeFormat().resolvedOptions().timeZone, now, now]
  );
  db.run("INSERT INTO store_members (store_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)", [
    STORE,
    ORGANIZER,
    now
  ]);
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at, auth_at) VALUES (?, ?, ?, ?)', [
    tokenHash,
    ORGANIZER,
    now + 365 * DAY,
    now
  ]);
}

/** "MM/DD/YYYY HH:MM:SS" in this browser's time, as the console sends it. */
function localTime(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${two(date.getMonth() + 1)}/${two(date.getDate())}/${date.getFullYear()} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
}

async function send(
  answer: Answer,
  env: TournamentEnv,
  path: string,
  body: unknown,
  method = 'POST'
): Promise<Record<string, unknown>> {
  const response = await answer(
    new Request(new URL(path, location.origin), {
      method,
      headers: { 'Content-Type': 'application/json', Origin: location.origin },
      body: JSON.stringify(body)
    }),
    env
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Demo seed: ${path} answered ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * Keeps the visitor signed in as the demo organizer, before every request: on
 * a new tab, and after Sign out, since there is nobody else to be here.
 */
export function stayingSignedIn(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS demo_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const meta = (key: string) => db.exec('SELECT value FROM demo_meta WHERE key = ?', [key])[0]?.values[0]?.[0];
  const token = meta('session');
  const hash = meta('session_hash');
  if (typeof token !== 'string' || typeof hash !== 'string') {
    return;
  }
  // Sign out deleted the session; the demo's one account takes it back.
  const now = Date.now();
  db.run('INSERT OR IGNORE INTO sessions (token_hash, user_id, expires_at, auth_at) VALUES (?, ?, ?, ?)', [
    hash,
    ORGANIZER,
    now + 365 * DAY,
    now
  ]);
  setCookie(SESSION_COOKIE, token);
}

export async function seed(env: TournamentEnv, db: Database, answer: Answer): Promise<void> {
  const now = Date.now();
  const token = crypto.randomUUID();
  const hash = await sha256(token);
  account(db, hash, now);
  db.run('CREATE TABLE IF NOT EXISTS demo_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.run("INSERT INTO demo_meta (key, value) VALUES ('session', ?), ('session_hash', ?)", [token, hash]);
  setCookie(SESSION_COOKIE, token);

  const created = await send(answer, env, '/api/tournaments', {
    mode: 'swiss',
    name: 'Demo Games League Challenge',
    roundTime: 50,
    store: STORE
  });
  const code = created.code as string;
  const players = DEMO_ENTRANTS.map((entrant, i) => {
    const [firstName = '', lastName = ''] = entrant.name.split(' ');
    return {
      firstName,
      lastName,
      id: String(FIRST_ID + i),
      birthDate: `06/15/${entrant.birthYear}`,
      list: DEMO_LISTS[entrant.list]
    };
  });
  for (const { firstName, lastName, id, birthDate } of players) {
    await send(answer, env, `/api/tournaments/${code}/commands`, {
      command: { type: 'addPlayer', player: { firstName, lastName, id, birthDate } },
      localTime: localTime(new Date())
    });
  }
  // Lists open, and every player's in, each named as Limitless names it.
  await send(answer, env, `/api/tournaments/${code}/settings`, { decklists: 'open', deckVisibility: 'after' }, 'PUT');
  for (const { firstName, lastName, id, birthDate, list } of players) {
    await send(
      answer,
      env,
      `/api/tournaments/${code}/decklists`,
      {
        profile: { popId: id, firstName, lastName, birthDate },
        mode: 'digital',
        deck: list?.text ?? '',
        localTime: localTime(new Date())
      },
      'PUT'
    );
    db.run('UPDATE decklists SET archetype = ? WHERE code = ? AND pop_id = ?', [list?.archetype ?? null, code, id]);
  }
}
