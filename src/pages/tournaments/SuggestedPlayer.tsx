/**
 * "Is this you?": the player a signed-in account looks to be (see
 * Viewer.suggest), asked about before the page asks which player they are.
 * Yes claims them when the account's answer is enough to, and otherwise only
 * shows their table, as it does when another device holds them; No is
 * remembered on the device, so the page asks once.
 */

import { createSignal, Show } from 'solid-js';
import type { TournamentView } from '../../../shared/tournament/view';
import { keepBrowserMemory, readBrowserMemory } from '../../lib/tournament/browserMemory';
import { ApiError, errorText, identifyPlayer } from '../../lib/tournament/api';
import { currentMatchOf, divisionHeading, namesById } from '../../lib/tournament/present';
import { ErrorLine } from './Field';
import type { Identified } from './Identify';

const declinedKey = (code: string) => `cm-tournament-not-me:${code}`;

/** Where the player is now: their division, and their table once they are paired. */
function whereNow(view: TournamentView, key: string): string {
  const match = currentMatchOf(view.tournament, key);
  const table = match && (match.match.p2 === null ? 'Bye' : `Table ${match.match.table}`);
  return [divisionHeading(view.divisions[key] ?? null), table].filter(Boolean).join(' · ');
}

/** The suggestion still to ask about: none once this device said No to that player. */
export function pendingSuggestion(view: TournamentView) {
  const { suggest } = view.viewer;
  return suggest && readBrowserMemory(declinedKey(view.code)) !== suggest.key ? suggest : undefined;
}

export function SuggestedPlayer(props: {
  view: TournamentView;
  suggest: NonNullable<TournamentView['viewer']['suggest']>;
  onIdentified: (found: Identified) => void;
  onDeclined: () => void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const name = () => namesById(props.view.tournament).get(props.suggest.key) ?? '';

  const showTable = () =>
    props.onIdentified({ key: props.suggest.key, view: props.view, claim: {}, lookup: true, reporter: false });

  async function confirm() {
    const { key, claim } = props.suggest;
    if (!claim) {
      showTable();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await identifyPlayer(props.view.code, claim, undefined, key);
      props.onIdentified({ ...found, claim, key });
    } catch (err) {
      // Held by another device: theirs to report from, though the table is still this player's.
      if (err instanceof ApiError && err.status === 409) {
        showTable();
        return;
      }
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  function decline() {
    keepBrowserMemory(declinedKey(props.view.code), props.suggest.key);
    props.onDeclined();
  }

  return (
    <>
      <h2 class='tm-you-q'>Is this you?</h2>
      <div class='tm-lookup-match'>
        <span>
          <strong>{name()}</strong>
          <Show when={whereNow(props.view, props.suggest.key)}>{where => <span class='muted'>{where()}</span>}</Show>
        </span>
        <button type='button' class='btn btn-primary' disabled={busy()} onClick={() => void confirm()}>
          That’s me
        </button>
        <button type='button' class='btn btn-ghost' disabled={busy()} onClick={decline}>
          Not me
        </button>
      </div>
      <ErrorLine message={error()} />
    </>
  );
}
