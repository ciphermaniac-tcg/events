/**
 * Pairing the next round while players have asked to drop: a player who left
 * would be paired, and their opponent handed a no-show. With a drop request
 * open, the pairing step asks first (see DropCheck), and pairs once the
 * requests are answered, or past them on purpose.
 */

import { createSignal, type JSX, lazy, Show, Suspense } from 'solid-js';
import { openDrops, type PlayerRequest } from '../../../shared/tournament/requests';
import type { Pod } from '../../../shared/tournament/types';
import type { Manage } from '../../lib/tournament/api';
import type { ManageState } from './manageState';

// Opened only with a drop request waiting, so it loads when first asked for.
const DropCheck = lazy(() => import('./DropCheck').then(m => ({ default: m.DropCheck })));

/** The open drop requests from the pod's players, oldest first. */
export const podDrops = (manage: Manage, pod: Pod | undefined): PlayerRequest[] =>
  pod ? openDrops(manage.requests ?? [], pod.playerIds) : [];

/** Pairs the pod's next round, or asks about its open drop requests first; `dialog` draws the asking. */
export function createDropGate(props: { state: () => ManageState; manage: () => Manage; pod: () => Pod | undefined }) {
  const [asking, setAsking] = createSignal(false);
  const drops = () => podDrops(props.manage(), props.pod());
  function pairNow() {
    const pod = props.pod();
    setAsking(false);
    if (pod) {
      void props.state().send({ type: 'pairRound', pod: pod.category });
    }
  }
  return {
    pair: () => (drops().length > 0 ? setAsking(true) : pairNow()),
    dialog: (label: string): JSX.Element => (
      <Show when={asking()}>
        <Suspense>
          <DropCheck
            state={props.state()}
            manage={props.manage()}
            drops={drops()}
            label={label}
            open
            onPair={pairNow}
            onClose={() => setAsking(false)}
          />
        </Suspense>
      </Show>
    )
  };
}
