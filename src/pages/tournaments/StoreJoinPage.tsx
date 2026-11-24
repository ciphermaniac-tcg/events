/**
 * /stores/join?invite=: a store's invite link. Signed in, it joins the store
 * at once and goes on to the dashboard's Organizing tab, where the store's
 * events now are; a link used, withdrawn or run out says so. Signed out, it
 * names the store and as what the link lets someone in, and sign-in comes
 * back here. A link with no invite in it says so either way.
 */

import { SessionGate } from './SessionGate';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createResource, createSignal, Show, untrack } from 'solid-js';
import { errorText } from '../../lib/tournament/api';
import { t } from '../../lib/i18n';
import { fetchInvite, joinStore } from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { TournamentHero } from './Hero';
import { refreshSession, session } from './session';
import { SignIn } from './SignIn';
import { ErrorState } from '@ciphermaniac/design/components/ErrorState';
import { pageTitle } from '../../lib/title';

export function StoreJoinPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams<{ invite?: string }>();
  const [failed, setFailed] = createSignal<string | null>(null);
  // A link cut short has nothing to join with, signed in or not.
  const error = () => (params.invite ? failed() : t('This invite link is incomplete.'));
  const user = () => latestValue(session)?.user;
  // Signed out, what the link is for; a link already gone says so before anyone signs in for it.
  const [invite] = createResource(
    () => (latestValue(session) && !user() ? params.invite : undefined),
    token => fetchInvite(token).catch((err: unknown) => void setFailed(errorText(err)))
  );
  const title = () => {
    const read = invite();
    if (!read) {
      return t('Join a store');
    }
    return read.role === 'manager'
      ? t('Join {store} as a manager', { store: read.store })
      : t('Join {store} as staff', { store: read.store });
  };
  createEffect(() => {
    document.title = pageTitle(error() ? t('This invite didn’t work') : title());
  });
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
      await joinStore(token);
      await refreshSession();
      navigate('/?tab=organizing', { replace: true });
    } catch (err) {
      setFailed(errorText(err));
    }
  }
  return (
    <div class='tm-page tm-narrow'>
      <Show when={!error()}>
        <TournamentHero title={title()} />
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
                    <div class='tm-box-bar'>
                      <SignIn
                        offer={s()}
                        next={`/stores/join?${new URLSearchParams({ invite: params.invite ?? '' })}`}
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
          <ErrorState code='' title={t('This invite didn’t work')} line={message()}>
            <A href='/' class='btn btn-primary'>
              {t('Go home')}
            </A>
          </ErrorState>
        )}
      </Show>
    </div>
  );
}
