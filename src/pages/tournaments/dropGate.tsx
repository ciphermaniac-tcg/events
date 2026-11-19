/**
 * Pairing the next round while players have asked to drop: a player who left
 * would be paired, and their opponent handed a no-show. With a drop request
 * open, the pairing step asks first (see DropCheck), and pairs once the
 * requests are answered, or past them on purpose.
 */

import { createSignal, type JSX, Show, Suspense } from 'solid-js';
import { lazyChunk } from '../../lib/preloadRecovery';
import { openDrops, type PlayerRequest } from '../../../shared/tournament/requests';
import type { Pod } from '../../../shared/tournament/types';
import type { Manage } from '../../lib/tournament/api';
import { namesById } from '../../lib/tournament/present';
import { tx } from '../../lib/i18n';
import { Answers } from './DropAnswers';
import type { ManageState } from './manageState';

// Opened only with a drop request waiting, so it loads when first asked for.
const DropCheck = lazyChunk(() => import('./DropCheck').then(m => ({ default: m.DropCheck })));

/** The open drop requests from the pod's players, oldest first. */
export const podDrops = (manage: Manage, pod: Pod | undefined): PlayerRequest[] =>
  pod ? openDrops(manage.requests ?? [], pod.playerIds) : [];

/**
 * The pod's oldest open drop request, in the console's head beside the next
 * step, with its answers; the rest wait their turn here and on Players.
 */
export function DropAsk(props: { state: ManageState; manage: Manage; pod: Pod | undefined }) {
  const drop = () =>
    props.manage.settings.finished || props.manage.watching ? undefined : podDrops(props.manage, props.pod)[0];
  return (
    <Show when={drop()} fallback={<span class='tm-grow' />}>
      {request => (
        <div class='tm-drop-ask'>
          <span>
            {tx('{name} asks to drop', {
              name: <strong>{namesById(props.manage.tournament).get(request().player) ?? request().player}</strong>
            })}
          </span>
          <Answers state={props.state} manage={props.manage} request={request()} />
        </div>
      )}
    </Show>
  );
}

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
