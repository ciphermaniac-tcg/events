/**
 * The tournament-key format, and the pure functions that read it.
 *
 * A tournament key is `YYYY-MM-DD, Event Name` — it doubles as the R2 folder
 * name and as the identifier the UI passes around, so parsing it is a shared
 * concern rather than a display concern. The rolling online meta is the one key
 * that does not follow the format; every function here special-cases it.
 *
 * Lives in `shared` because the daily majors-trends pipeline classifies and
 * dates events exactly the way the selector does, and it was reaching up into
 * `src/lib/data.ts` to do it — a producer depending on the browser layer, which
 * is the dependency direction inverted.
 * @module shared/data/tournamentKeys
 */

/**
 * Folder key for the rolling online-meta aggregate. Matches the upstream
 * `reports/{name}/` path on R2 exactly, so it doubles as a tournament-list
 * entry and a fetch path. `src/lib/constants` re-exports it for the frontend.
 */
export const ONLINE_META_NAME = 'Online - Last 14 Days';
