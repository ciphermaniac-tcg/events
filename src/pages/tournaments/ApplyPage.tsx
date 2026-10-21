/**
 * /apply: an account starts running events, one of two ways, picked from two
 * rows. A Community organizer runs unsanctioned events under its own name,
 * and becomes one at once; a Store is a certified Play! Pokémon league
 * location, which an admin approves from its Application (see
 * StoreApplicationForm). Only an account whose profile is complete, its POP
 * ID included, may apply for a store; an incomplete one is sent to Settings.
 * An account with an Application pending sees where it stands instead (see
 * ApplicantStatus); a rejected one, or one whose access was removed, opens
 * the rows again from there. Signed out, one box to sign in.
 */

import { SessionGate } from './SessionGate';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createResource, createSignal, type JSX, onMount, Show, untrack } from 'solid-js';
import { canJoinCommunity } from '../../../shared/accounts/roles';
import type { MyApplication } from '../../../shared/accounts/types';
import { errorText, type Me, type SignInOffer } from '../../lib/tournament/api';
import { msg, t, tx } from '../../lib/i18n';
import { applicantStage, fetchApplication } from '../../lib/tournament/applications';
import { joinCommunity } from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { ApplicantStatus, createSessionCatchUp } from './ApplicantStatus';
import { ErrorLine, ResourceFallback } from './Field';
import { TournamentHero } from './Hero';
import { refreshSession } from './session';
import { SignIn } from './SignIn';
import { StoreApplicationForm } from './StoreApplicationForm';
import '../../styles/pages/tournament-store-apply.css';
import { pageTitle } from '../../lib/title';

const TITLE = msg('Run events');

type Path = 'community' | 'store';

const PATHS: Record<Path, { title: string; joined: string; line: string; held: string }> = {
  community: {
    title: msg('I want to run a tournament for fun'),
    joined: msg('Community organizer'),
    line: msg("Run unofficial, unsanctioned events using Ciphermaniac's swiss system."),
    held: msg('You are currently approved for unsanctioned events.')
  },
  store: {
    title: msg('I run an official Play! Pokémon store'),
    joined: msg('I run an official Play! Pokémon store'),
    line: msg('Sync TOM with Ciphermaniac to run sanctioned events with our tools. Requires admin approval.'),
    held: msg('You are currently not approved for sanctioned events.')
  }
};

function SignedOut(props: { offer: SignInOffer }) {
  return (
    <>
      <TournamentHero title={t(TITLE)} />
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>{t('Sign in')}</strong>
          <span class='tm-grow' />
          <span class='tm-flag'>{t('Signed out')}</span>
        </div>
        <div class='tm-box-bar'>
          <SignIn offer={props.offer} next='/apply' />
        </div>
      </section>
    </>
  );
}

/** One way in: what it is, and, for a Community organizer, what it may run and may not yet. */
function PathRow(props: { path: Path; joined: boolean; children: JSX.Element }) {
  const words = () => PATHS[props.path];
  return (
    <div class='tm-path'>
      <div class='tm-path-text'>
        <h2 class='tm-path-title'>{t(props.joined ? words().joined : words().title)}</h2>
        <span class='muted'>{t(words().line)}</span>
        <Show when={props.joined}>
          <span class='tm-path-held' classList={{ 'is-held': props.path === 'community' }}>
            {t(words().held)}
          </span>
        </Show>
      </div>
      {props.children}
    </div>
  );
}

/** Becoming a Community organizer: one press, then on to the events page. */
function CommunityStart() {
  const navigate = useNavigate();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      await joinCommunity();
      await refreshSession();
      navigate('/');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <span class='tm-path-step'>
      <button type='button' class='btn btn-primary' disabled={busy()} onClick={() => void start()}>
        {t('Community organizer')}
      </button>
      <ErrorLine message={error()} />
    </span>
  );
}

/**
 * The two ways in, one row each: a player may become a Community organizer
 * at once; a Community organizer is told it runs unsanctioned events alone,
 * with the way to its events; any account may open the store application.
 */
function PathRows(props: { role: Me['role']; store: boolean; storeOpen: boolean; onStore: () => void }) {
  const joined = () => props.role === 'community';
  return (
    <section class='tm-box tm-paths'>
      <Show when={canJoinCommunity(props.role) || joined()}>
        <PathRow path='community' joined={joined()}>
          <Show when={joined()} fallback={<CommunityStart />}>
            <A class='btn btn-secondary' href='/'>
              {t('Your events')}
            </A>
          </Show>
        </PathRow>
      </Show>
      <Show when={!props.store}>
        <PathRow path='store' joined={joined()}>
          <button
            type='button'
            class='btn btn-secondary'
            aria-expanded={props.storeOpen}
            onClick={() => props.onStore()}
          >
            {t('Apply as store')}
          </button>
        </PathRow>
      </Show>
    </section>
  );
}

/** Signed in: where the account stands, then the rows when it may take one now. */
function Applying(props: { user: Me }) {
  const [params] = useSearchParams<{ again?: string }>();
  const [state, { refetch, mutate }] = createResource(fetchApplication);
  // Settings' Apply again opens the rows as the page opens, at the store, which is what was applied for.
  const [again, setAgain] = createSignal(params.again !== undefined);
  const [storeOpen, setStoreOpen] = createSignal(untrack(again));
  const current = () => latestValue(state);
  createSessionCatchUp(
    () => props.user.role,
    () => current()?.application
  );
  const stage = () => applicantStage(props.user.role, current()?.application ?? null);
  const open = () => stage() !== 'pending' && ((stage() !== 'rejected' && stage() !== 'revoked') || again());
  const sent = (application: MyApplication) => mutate(prev => prev && { ...prev, application });
  return (
    <>
      <TournamentHero title={t(TITLE)} />
      <Show when={current()} fallback={<ResourceFallback resource={state} onRetry={() => void refetch()} small />}>
        {s => (
          <div class='tm-apply'>
            <Show when={stage() !== 'none' && stage() !== 'community'}>
              <ApplicantStatus
                stage={stage()}
                application={s().application}
                again={!open()}
                onApplyAgain={() => {
                  setAgain(true);
                  setStoreOpen(true);
                }}
                onChanged={() => void refetch()}
              />
            </Show>
            <Show when={open()}>
              <PathRows
                role={props.user.role}
                store={stage() === 'store'}
                storeOpen={storeOpen()}
                onStore={() => setStoreOpen(true)}
              />
              <Show when={storeOpen()}>
                <Show
                  when={s().eligible.profile}
                  fallback={
                    <>
                      <p class='tm-apply-profile'>
                        {t('A store application needs your Player ID, name and birth year.')}
                      </p>
                      <p class='tm-apply-profile'>
                        <A class='btn btn-primary' href='/settings'>
                          {t('Complete your profile')}
                        </A>
                      </p>
                    </>
                  }
                >
                  <Show
                    when={s().eligible.email}
                    fallback={
                      // Linking Google or Discord gives the account its email (see linkIdentity).
                      <p class='tm-apply-profile'>
                        {tx(
                          'A store application needs an email we can reach you at. Link Google or Discord in {settings} to add one.',
                          {
                            settings: (
                              <A class='tm-link-inline' href='/settings'>
                                {t('Settings')}
                              </A>
                            )
                          }
                        )}
                      </p>
                    }
                  >
                    <StoreApplicationForm
                      onSent={sent}
                      onStale={() => {
                        void refetch();
                        void refreshSession();
                      }}
                    />
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}

export function ApplyPage() {
  onMount(() => {
    document.title = pageTitle(t(TITLE));
  });
  return (
    <div class='tm-page tm-narrow tm-apply-page'>
      <SessionGate>
        {s => (
          <Show when={s().user} fallback={<SignedOut offer={s()} />}>
            {user => <Applying user={user()} />}
          </Show>
        )}
      </SessionGate>
    </div>
  );
}
