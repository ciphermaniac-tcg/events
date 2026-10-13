/**
 * /history: the events run here that the signed-in account played, through
 * its POP ID at sanctioned events or its Claims at unsanctioned ones, newest
 * first (see HistoryList). Signed out, one box to sign in.
 */

import { createResource, onMount, Show } from 'solid-js';
import { Skeleton } from '../../components/Skeleton';
import { errorText, fetchHistory, type SignInOffer } from '../../lib/tournament/api';
import { latestValue, resolved } from '../../lib/resource';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { ProfileHistory } from './ProfileHistory';
import { session } from './session';
import { SignIn } from './SignIn';
import { pageTitle } from '../../lib/title';

function SignedOut(props: { offer: SignInOffer }) {
  return (
    <>
      <TournamentHero title='History' tab='playing' />
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>Sign in</strong>
          <span class='tm-grow' />
          <span class='tm-flag'>Signed out</span>
        </div>
        <div class='tm-box-bar'>
          <SignIn offer={props.offer} next='/history' />
        </div>
      </section>
    </>
  );
}

function MyHistory() {
  const [history, { refetch }] = createResource(fetchHistory);
  const entries = () => resolved(history);
  return (
    <>
      <TournamentHero title='History' tab='playing' />
      <Show
        when={entries()}
        fallback={
          <Show when={history.error} fallback={<Skeleton height='160px' />}>
            <ErrorLine message={errorText(history.error)} />
            <button type='button' class='btn btn-secondary tm-small' onClick={() => void refetch()}>
              Retry
            </button>
          </Show>
        }
      >
        {list => <ProfileHistory entries={list().entries} activity={list().activity} />}
      </Show>
    </>
  );
}

export function HistoryPage() {
  const current = () => latestValue(session);
  onMount(() => {
    document.title = pageTitle('History');
  });
  return (
    <div class='tm-page'>
      <Show when={current()}>
        {s => (
          <Show when={s().user} fallback={<SignedOut offer={s()} />}>
            <MyHistory />
          </Show>
        )}
      </Show>
    </div>
  );
}
