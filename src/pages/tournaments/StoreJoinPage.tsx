/**
 * /stores/join?invite=: a store's invite link. Signed in, it joins the store
 * at once and goes on to the store's page; a link used, withdrawn or run out
 * says so. Signed out, it says what signing in is for, and sign-in comes back
 * here. A link with no invite in it says so either way.
 */

import { SessionGate } from './SessionGate';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createSignal, Show, untrack } from 'solid-js';
import { errorText } from '../../lib/tournament/api';
import { t } from '../../lib/i18n';
import { joinStore } from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { TournamentHero } from './Hero';
import { refreshSession, session } from './session';
import { SignIn } from './SignIn';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';

export function StoreJoinPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams<{ invite?: string }>();
  const [failed, setFailed] = createSignal<string | null>(null);
  // A link cut short has nothing to join with, signed in or not.
  const error = () => (params.invite ? failed() : t('This invite link is incomplete.'));
  const user = () => latestValue(session)?.user;
  let tried = false;
  createEffect(() => {
    const token = params.invite;
    if (!user() || !token || tried) {
      return;
    }
    tried = true;
    untrack(() => void join(token));
  });
  async function join(token: string) {
    try {
      const { storeId } = await joinStore(token);
      await refreshSession();
      navigate(`/stores/${storeId}`, { replace: true });
    } catch (err) {
      setFailed(errorText(err));
    }
  }
  return (
    <div class='tm-page tm-narrow'>
      <Show when={!error()}>
        <TournamentHero title={t('Join a store')} />
      </Show>
      <Show
        when={error()}
        fallback={
          <SessionGate>
            {s => (
              <Show
                when={s().user}
                fallback={
                  <section class='tm-box'>
                    <p class='tm-box-bar'>{t('Sign in to join this store’s staff.')}</p>
                    <div class='tm-box-bar'>
                      <SignIn
                        offer={s()}
                        next={`/stores/join?${new URLSearchParams({ invite: params.invite ?? '' }).toString()}`}
                      />
                    </div>
                  </section>
                }
              >
                <p class='muted' role='status'>
                  {t('Joining')}
                </p>
              </Show>
            )}
          </SessionGate>
        }
      >
        {message => (
          <ErrorState code={t('Invite')} title={t('This invite didn’t work')} line={message()}>
            <A href='/' class='btn btn-primary'>
              {t('Go home')}
            </A>
          </ErrorState>
        )}
      </Show>
    </div>
  );
}
