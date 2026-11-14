/** The linked .tdf and the event TOM last saved into it. */

import { createSignal, onCleanup, onMount } from 'solid-js';
import { parseTdf } from '../../../shared/tournament/tdf';
import type { Tournament } from '../../../shared/tournament/types';
import { followFile, pickTdf, recallTdf, rememberTdf } from './tdfFile';
import { errorText } from './tom';

export function createTdfState() {
  const [path, setPath] = createSignal<string | null>(null);
  const [tournament, setTournament] = createSignal<Tournament | null>(null);
  const [readAt, setReadAt] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let stop = () => {};

  function follow(next: string) {
    stop();
    setPath(next);
    rememberTdf(next);
    setTournament(null);
    stop = followFile(
      next,
      text => {
        setTournament(parseTdf(text));
        setReadAt(Date.now());
        setError(null);
      },
      err => setError(errorText(err))
    );
  }

  onMount(() => {
    const remembered = recallTdf();
    if (remembered) {
      follow(remembered);
    }
  });
  onCleanup(() => stop());

  return {
    path,
    tournament,
    readAt,
    error,
    link: async () => {
      try {
        const picked = await pickTdf();
        if (picked) {
          follow(picked);
        }
      } catch (err) {
        setError(errorText(err));
      }
    }
  };
}

export type TdfState = ReturnType<typeof createTdfState>;
