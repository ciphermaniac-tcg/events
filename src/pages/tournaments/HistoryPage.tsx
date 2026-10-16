/**
 * /history: the events run here that the signed-in account played, through
 * its POP ID at sanctioned events or its Claims at unsanctioned ones, newest
 * first (see HistoryList). Signed out, one box to sign in.
 */

import { SessionGate } from './SessionGate';
import { createResource, onMount, Show } from 'solid-js';
import { fetchHistory, type SignInOffer } from '../../lib/tournament/api';
import { resolved } from '../../lib/resource';
import { ResourceFallback } from './Field';
import { TournamentHero } from './Hero';
import { ProfileHistory } from './ProfileHistory';
import { SignIn } from './SignIn';
import { pageTitle } from '../../lib/title';
import { t } from '../../lib/i18n';

function SignedOut(props: { offer: SignInOffer }) {
  return (
    <>
      <TournamentHero title={t('History')} tab='playing' />
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>{t('Sign in')}</strong>
          <span class='tm-grow' />
          <span class='tm-flag'>{t('Signed out')}</span>
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
      <TournamentHero title={t('History')} tab='playing' />
      <Show when={entries()} fallback={<ResourceFallback resource={history} onRetry={() => void refetch()} small />}>
        {list => <ProfileHistory entries={list().entries} activity={list().activity} />}
      </Show>
    </>
  );
}

export function HistoryPage() {
  onMount(() => {
    document.title = pageTitle(t('History'));
  });
  return (
    <div class='tm-page'>
      <SessionGate>
        {s => (
          <Show when={s().user} fallback={<SignedOut offer={s()} />}>
            <MyHistory />
          </Show>
        )}
      </SessionGate>
    </div>
  );
}
