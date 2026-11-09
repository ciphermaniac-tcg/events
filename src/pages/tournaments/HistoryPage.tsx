/**
 * /history: the events run here that the signed-in account played, through
 * its POP ID at sanctioned events or its Claims at unsanctioned ones, newest
 * first (see HistoryList). Signed out, one box to sign in.
 */

import { SessionGate } from './SessionGate';
import { onMount, Show, untrack } from 'solid-js';
import { fetchHistory } from '../../lib/tournament/api';
import { accountList } from '../../lib/tournament/accountMemory';
import { latestValue } from '../../lib/resource';
import { ResourceFallback } from './Field';
import { TournamentHero } from './Hero';
import { ProfileHistory } from './ProfileHistory';
import { SignedOutBox } from './SignIn';
import { pageTitle } from '../../lib/title';
import { t } from '../../lib/i18n';

function MyHistory(props: { account: string }) {
  // Opens on this tab's last answer, if any, while History is read again.
  const [history, { refetch }] = accountList(
    'history',
    untrack(() => props.account),
    fetchHistory
  );
  const entries = () => latestValue(history);
  return (
    <Show when={entries()} fallback={<ResourceFallback resource={history} onRetry={() => void refetch()} small />}>
      {list => <ProfileHistory entries={list().entries} activity={list().activity} />}
    </Show>
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
          <>
            <TournamentHero title={t('History')} tab='playing' />
            <Show when={s().user} fallback={<SignedOutBox offer={s()} next='/history' />}>
              {/* Keyed on the account: a kept session can give way to another one. */}
              {user => (
                <Show when={user().id} keyed>
                  {account => <MyHistory account={account} />}
                </Show>
              )}
            </Show>
          </>
        )}
      </SessionGate>
    </div>
  );
}
