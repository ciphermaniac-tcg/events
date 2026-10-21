/**
 * How a player proves which player they are: their Player ID and birth year
 * at a sanctioned event, their last name at an unsanctioned one (whose public page shows last
 * names shortened), with the first name when two players share it. Used by
 * "Which player are you?" and by "This is me" in a player sheet, where the
 * answer has to be that player's.
 */

import { createSignal, For, Show } from 'solid-js';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import { isSanctioned, type PublishedView, type TournamentView } from '../../../shared/tournament/view';
import { ApiError, errorText, identifyPlayer, type LookupCandidate, lookupPlayer } from '../../lib/tournament/api';
import { currentMatchOf, divisionHeading } from '../../lib/tournament/present';
import { ErrorLine, Field } from './Field';
import { BirthYearInput, PlayerIdInput } from './ProfileFields';
import { t, tn } from '../../lib/i18n';

export interface Identified {
  claim: PlayerClaim;
  /** Table lookup alone never claims a reporting seat. */
  lookup?: boolean;
  key: string;
  view: PublishedView;
  /** The token to keep, when this device just became the one that reports for the player. */
  reportToken?: string;
  /** Whether this device reports for them: false for a lookup. */
  reporter?: boolean;
  /** Whether the player is the signed-in account's at this event. */
  linked?: boolean;
}

interface IdentifyProps {
  view: TournamentView;
  idPrefix: string;
  submitLabel: string;
  /** The player the answer must be, when there is one. */
  expect?: string;
  /** Take focus on opening, as the sheet's form does once "This is me" is pressed. */
  autofocus?: boolean;
  onFound: (found: Identified) => void;
}

export function IdentifyForm(props: IdentifyProps & { lookup?: boolean }) {
  return (
    <Show when={props.lookup} fallback={<ClaimForm {...props} />}>
      <LookupForm {...props} />
    </Show>
  );
}

function ClaimForm(props: IdentifyProps) {
  const sanctioned = () => isSanctioned(props.view);
  const [value, setValue] = createSignal('');
  const [first, setFirst] = createSignal('');
  const [year, setYear] = createSignal('');
  const [ambiguous, setAmbiguous] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const focusOpening = (el: HTMLInputElement) => {
    if (props.autofocus) {
      queueMicrotask(() => el.focus());
    }
  };
  const wrong = () =>
    sanctioned() ? t('That Player ID and birth year isn’t this player’s') : t('That last name isn’t this player’s');

  const claimOf = (): PlayerClaim =>
    sanctioned()
      ? { popId: value().trim(), birthYear: year().trim() }
      : { lastName: value().trim(), ...(first().trim() ? { firstName: first().trim() } : {}) };
  /**
   * Why it failed: in a sheet, a miss is that it isn't this player; two
   * sharing a last name asks for more, and too many wrong years says so.
   */
  const failure = (err: unknown) => {
    const twoShare = err instanceof ApiError && err.body?.ambiguous === true;
    const miss = err instanceof ApiError && err.status === 404;
    setAmbiguous(twoShare);
    setError(props.expect !== undefined && miss && !twoShare ? wrong() : errorText(err));
  };

  async function find(event: Event) {
    event.preventDefault();
    const claim = claimOf();
    setBusy(true);
    setError(null);
    try {
      const found = await identifyPlayer(props.view.code, claim, undefined, props.expect);
      if (!found.key || (props.expect !== undefined && found.key !== props.expect)) {
        setError(wrong());
        return;
      }
      props.onFound({ ...found, claim, key: found.key });
    } catch (err) {
      failure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class='tm-identify' onSubmit={event => void find(event)}>
      <Field id={`${props.idPrefix}-id`} label={sanctioned() ? t('Player ID') : t('Last name')}>
        <Show
          when={sanctioned()}
          fallback={
            <input
              id={`${props.idPrefix}-id`}
              ref={el => focusOpening(el)}
              class='tm-input'
              autocomplete='family-name'
              value={value()}
              onInput={e => setValue(e.currentTarget.value)}
            />
          }
        >
          <PlayerIdInput id={`${props.idPrefix}-id`} ref={el => focusOpening(el)} value={value()} onValue={setValue} />
        </Show>
      </Field>
      <Show when={sanctioned()}>
        <Field id={`${props.idPrefix}-year`} label={t('Birth year')}>
          <BirthYearInput id={`${props.idPrefix}-year`} value={year()} onValue={setYear} />
        </Field>
      </Show>
      <Show when={ambiguous()}>
        <Field id={`${props.idPrefix}-first`} label={t('First name')}>
          <input
            id={`${props.idPrefix}-first`}
            class='tm-input'
            autocomplete='given-name'
            value={first()}
            onInput={e => setFirst(e.currentTarget.value)}
          />
        </Field>
      </Show>
      <button
        type='submit'
        class='btn btn-primary'
        disabled={busy() || !value().trim() || (sanctioned() && year().length !== 4)}
      >
        {props.submitLabel}
      </button>
      <ErrorLine message={error()} />
    </form>
  );
}

/** Read-only surname lookup. Candidate confirmation never submits a reporting claim. */
function LookupForm(props: IdentifyProps) {
  const [last, setLast] = createSignal('');
  const [first, setFirst] = createSignal('');
  const [narrow, setNarrow] = createSignal(false);
  const [answer, setAnswer] = createSignal<{ candidates: LookupCandidate[]; view: PublishedView } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  /** Each search's number: an answer for a search since replaced or edited is dropped. */
  let asked = 0;
  async function find(event: Event) {
    event.preventDefault();
    const ask = ++asked;
    setBusy(true);
    setAnswer(null);
    setError(null);
    try {
      const found = await lookupPlayer(props.view.code, { lastName: last().trim(), firstName: first().trim() });
      if (ask !== asked) {
        return;
      }
      setAnswer(found);
      setNarrow(found.candidates.length > 1 || narrow());
      setError(found.candidates.length === 0 ? t('No matching player') : null);
    } catch (err) {
      setError(ask === asked ? errorText(err) : null);
    } finally {
      setBusy(false);
    }
  }
  const table = (key: string) => {
    const found = answer();
    if (!found) {
      return '';
    }
    const match = currentMatchOf(found.view.tournament, key);
    if (!match) {
      return t('Not paired');
    }
    return match.match.p2 === null ? t('Bye') : t('Table {n}', { n: match.match.table });
  };
  /** What the search found, for the status line screen readers announce. */
  const status = () => {
    const count = answer()?.candidates.length ?? 0;
    if (count === 0) {
      return '';
    }
    const found = tn(count, '{n} matching player', '{n} matching players');
    return count > 1 && !first().trim() ? `${found}. ${t('Add a first name to narrow the list.')}` : found;
  };
  const details = (candidate: LookupCandidate) =>
    [divisionHeading(answer()?.view.divisions[candidate.key] ?? null), table(candidate.key)].filter(Boolean);
  function confirm(candidate: LookupCandidate) {
    const found = answer();
    if (found) {
      props.onFound({ key: candidate.key, view: found.view, claim: {}, lookup: true, reporter: false });
    }
  }
  return (
    <form class='tm-identify' onSubmit={event => void find(event)}>
      <Field id={`${props.idPrefix}-last`} label={t('Last name')}>
        <input
          id={`${props.idPrefix}-last`}
          class='tm-input'
          autocomplete='family-name'
          value={last()}
          onInput={event => {
            setLast(event.currentTarget.value);
            asked++;
            setAnswer(null);
            setFirst('');
            setNarrow(false);
          }}
        />
      </Field>
      <Show when={narrow()}>
        <Field id={`${props.idPrefix}-first`} label={t('First name')}>
          <input
            id={`${props.idPrefix}-first`}
            class='tm-input'
            autocomplete='given-name'
            value={first()}
            onInput={event => {
              setFirst(event.currentTarget.value);
              asked++;
              setAnswer(null);
            }}
          />
        </Field>
      </Show>
      <button type='submit' class='btn btn-primary' disabled={busy() || !last().trim()}>
        {props.submitLabel}
      </button>
      <p class='muted tm-lookup-status' role='status'>
        {status()}
      </p>
      <Show when={answer()?.candidates.length}>
        <div class='tm-lookup-matches' role='group' aria-label={t('Choose your player')}>
          <For each={answer()?.candidates}>
            {candidate => (
              <div class='tm-lookup-match'>
                <span>
                  <strong>
                    {candidate.firstName} {candidate.lastName}
                  </strong>
                  <span class='muted'>{details(candidate).join(' · ')}</span>
                </span>
                <button
                  type='button'
                  class='btn btn-secondary'
                  aria-label={[
                    t('Show table for {name}', { name: `${candidate.firstName} ${candidate.lastName}` }),
                    ...details(candidate)
                  ].join(', ')}
                  onClick={() => confirm(candidate)}
                >
                  {t('Show table')}
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <ErrorLine message={error()} />
    </form>
  );
}
