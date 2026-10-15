/**
 * The TOM file reader alone, for the home page to load on the first .tdf
 * picked. Imported whole, the file's module would bring its writer's exports
 * along with it.
 */
export { parseTdf } from '../../../shared/tournament/tdf';
