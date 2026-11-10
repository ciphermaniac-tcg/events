/**
 * The events data bucket, kept in the demo's own database so what the
 * functions publish survives a reload with everything else.
 */

import type { Database } from 'sql.js';
import type { PublishBucket, PublishedObject } from '../../functions/lib/types';

export interface DemoBucket extends PublishBucket {
  /** An object's text; null when there is none. */
  read: (key: string) => string | null;
}

/** The bucket in the database `db` gives, asked for at each call, as browserD1 asks. */
export function demoBucket(db: () => Database, changed: () => void): DemoBucket {
  db().exec('CREATE TABLE IF NOT EXISTS demo_objects (key TEXT PRIMARY KEY, value TEXT NOT NULL, etag TEXT NOT NULL)');
  const etagOf = (key: string) =>
    (db().exec('SELECT etag FROM demo_objects WHERE key = ?', [key])[0]?.values[0]?.[0] as string | undefined) ?? null;
  const read = (key: string) =>
    (db().exec('SELECT value FROM demo_objects WHERE key = ?', [key])[0]?.values[0]?.[0] as string | undefined) ?? null;
  return {
    head: key => {
      const etag = etagOf(key);
      return Promise.resolve(etag === null ? null : ({ etag } satisfies PublishedObject));
    },
    put: (key, value, options) => {
      const wanted = options.onlyIf && 'etagMatches' in options.onlyIf ? options.onlyIf.etagMatches : null;
      if (wanted !== null && wanted !== etagOf(key)) {
        return Promise.resolve(null);
      }
      const etag = crypto.randomUUID();
      db().run('INSERT OR REPLACE INTO demo_objects (key, value, etag) VALUES (?, ?, ?)', [key, value, etag]);
      changed();
      return Promise.resolve({ etag, customMetadata: options.customMetadata });
    },
    delete: key => {
      db().run('DELETE FROM demo_objects WHERE key = ?', [key]);
      changed();
      return Promise.resolve(true);
    },
    get: key => {
      const value = read(key);
      return Promise.resolve(value === null ? null : { text: () => Promise.resolve(value) });
    },
    read
  };
}
