/**
 * The desktop app's TOM panel: beta tooling that sends results to TOM as
 * the codes its match slips print, worked out from the .tdf TOM saves.
 */

import { FileSection } from './FileSection';
import { createLog } from './log';
import { ManualCode } from './ManualCode';
import { OpenTables } from './OpenTables';
import { ResultLog } from './ResultLog';
import { createTdfState } from './tdfState';
import { TomSection } from './TomSection';
import { createTomState } from './tomState';

export function App() {
  const tom = createTomState();
  const file = createTdfState();
  const log = createLog();
  return (
    <main class='tp'>
      <h1>TOM link</h1>
      <TomSection state={tom} log={log} />
      <FileSection file={file} />
      <OpenTables tournament={file.tournament()} log={log} />
      <ManualCode tournament={file.tournament()} log={log} />
      <ResultLog entries={log.entries()} />
    </main>
  );
}
