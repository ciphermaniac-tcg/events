/**
 * /apply: an account starts running events, one of two ways, picked from two
 * rows. A Community organizer runs unsanctioned events under its own name,
 * and becomes one at once; a Store is a certified Play! Pokémon league
 * location, which an admin approves from its Application (see
 * StoreApplicationForm). Only an account whose profile is complete, its POP
 * ID included, and which has an email may apply for a store; one without is
 * shown everything it lacks at once, each with the way to it in Settings
 * (which offers the way back). An account in a store sees its stores in
 * place of the store row. An account with an Application pending sees where
 * it stands instead (see ApplicantStatus); a rejected one, or one whose
 * access was removed, opens the rows again from there. Signed out, the two
 * rows to read, and one box to sign in.
 */

import { SessionGate } from './SessionGate';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createResource, createSignal, For, type JSX, onMount, Show, untrack } from 'solid-js';
import { canJoinCommunity } from '../../../shared/accounts/roles';
import { managesStore } from '../../../shared/accounts/stores';
import type { ApplicationState, MyApplication, MyStore } from '../../../shared/accounts/types';
import { type Me } from '../../lib/tournament/api';
import { msg, t } from '../../lib/i18n';
import { applicantStage, fetchApplication } from '../../lib/tournament/applications';
import { joinCommunity } from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { ApplicantStatus, createSessionCatchUp } from './ApplicantStatus';
import { ErrorLine, ResourceFallback } from './Field';
import { TournamentHero } from './Hero';
import { refreshSession } from './session';
import { SignedOutBox } from './SignIn';
import { applicationDraftKey, readApplicationDraft, StoreApplicationForm } from './StoreApplicationForm';
import '../../styles/pages/tournament-store-apply.css';
import { pageTitle } from '../../lib/title';
import { createAction } from './action';

const TITLE = msg('Run events');

type Path = 'community' | 'store';

const PATHS: Record<Path, { title: string; joined: string; line: string; held: string }> = {
  community: {
    title: msg('I want to run a tournament for fun'),
    joined: msg('Community organizer'),
    line: msg('Run unofficial, unsanctioned events using Ciphermaniac’s Swiss system.'),
    held: msg('You are currently approved for unsanctioned events.')
  },
  store: {
    title: msg('I run an official Play! Pokémon store'),
    joined: msg('I run an official Play! Pokémon store'),
    line: msg('Sync TOM with Ciphermaniac to run sanctioned events with our tools. Requires admin approval.'),
    held: msg('You are currently not approved for sanctioned events.')
  }
};

/** One way in: what it is, and, for a Community organizer, what it may run and may not yet. */
function PathRow(props: { path: Path; joined: boolean; children?: JSX.Element }) {
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

/** A store the account is in: the way to its settings for a Manager, its page for Staff. */
function StoreRow(props: { store: MyStore }) {
  const manages = () => managesStore(props.store.role);
  return (
    <div class='tm-path'>
      <div class='tm-path-text'>
        <h2 class='tm-path-title'>{props.store.name}</h2>
        <span class='muted'>{t('You run this store.')}</span>
      </div>
      <A
        class='btn btn-secondary'
        href={manages() ? `/stores/${props.store.id}/settings` : `/stores/${props.store.id}`}
      >
        {manages() ? t('Store settings') : t('Store page')}
      </A>
    </div>
  );
}

/** What a store application needs that the account lacks, each with the way to it in Settings. */
function StoreNeeds(props: { eligible: ApplicationState['eligible'] }) {
  return (
    <>
      <p class='tm-apply-lead'>{t('A store application needs:')}</p>
      <ul class='tm-apply-needs'>
        <Show when={!props.eligible.profile}>
          <li>
            <span>{t('Your name and Player ID')}</span>
            <A class='btn btn-secondary' href='/settings?section=profile&next=%2Fapply%3Fstore'>
              {t('Add in Settings')}
            </A>
          </li>
        </Show>
        <Show when={!props.eligible.email}>
          {/* Linking Google or Discord gives the account its email (see linkIdentity). */}
          <li>
            <span>{t('An email from Google or Discord')}</span>
            <A class='btn btn-secondary' href='/settings?next=%2Fapply%3Fstore'>
              {t('Link in Settings')}
            </A>
          </li>
        </Show>
      </ul>
    </>
  );
}

/** Becoming a Community organizer: one press, then on to the events page. */
function CommunityStart() {
  const navigate = useNavigate();
  const action = createAction({ staysBusy: true });
  async function start() {
    await action.run(async () => {
      await joinCommunity();
      await refreshSession();
      navigate('/');
    });
  }
  return (
    <span class='tm-path-step'>
      <button type='button' class='btn btn-primary' disabled={action.busy()} onClick={() => void start()}>
        {t('Community organizer')}
      </button>
      <ErrorLine message={action.error()} />
    </span>
  );
}

/**
 * The two ways in, one row each: a player may become a Community organizer
 * at once; a Community organizer is told it runs unsanctioned events alone,
 * with the way to its events; any account may open the store application,
 * and one already in a store sees its stores instead, with a quieter way
 * to apply for another under them.
 */
function PathRows(props: { user: Me; store: boolean; storeOpen: boolean; onStore: () => void }) {
  const joined = () => props.user.role === 'community';
  const stores = () => props.user.stores;
  return (
    <>
      <section class='tm-box tm-paths'>
        <Show when={canJoinCommunity(props.user.role) || joined()}>
          <PathRow path='community' joined={joined()}>
            <Show when={joined()} fallback={<CommunityStart />}>
              <A class='btn btn-secondary' href='/'>
                {t('Your events')}
              </A>
            </Show>
          </PathRow>
        </Show>
        <For each={stores()}>{store => <StoreRow store={store} />}</For>
        <Show when={!props.store && stores().length === 0}>
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
      <Show when={stores().length > 0 && !props.storeOpen}>
        <p class='tm-apply-another'>
          <button type='button' onClick={() => props.onStore()}>
            {t('Apply for another store')}
          </button>
        </p>
      </Show>
    </>
  );
}

/** Signed in: where the account stands, then the rows when it may take one now. */
function Applying(props: { user: Me }) {
  // `store`: back from Settings, where the store application sent the account for what it needs.
  const [params] = useSearchParams<{ again?: string; store?: string }>();
  const [state, { refetch, mutate }] = createResource(fetchApplication);
  const draftKey = untrack(() => applicationDraftKey(props.user.id));
  // An application begun in this tab opens again as it was left, as Apply again from it would.
  const drafted = Object.keys(readApplicationDraft(draftKey)).length > 0;
  // Settings' Apply again opens the rows as the page opens, at the store, which is what was applied for.
  const [again, setAgain] = createSignal(params.again !== undefined || drafted);
  const [storeOpen, setStoreOpen] = createSignal(untrack(again) || params.store !== undefined);
  const current = () => latestValue(state);
  createSessionCatchUp(
    () => props.user.role,
    () => current()?.application
  );
  const stage = () => applicantStage(props.user.role, current()?.application ?? null);
  const open = () => stage() !== 'pending' && ((stage() !== 'rejected' && stage() !== 'revoked') || again());
  const sent = (application: MyApplication) => mutate(prev => prev && { ...prev, application });
  return (
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
              user={props.user}
              store={stage() === 'store'}
              storeOpen={storeOpen()}
              onStore={() => setStoreOpen(true)}
            />
            <Show when={storeOpen()}>
              <Show when={s().eligible.profile && s().eligible.email} fallback={<StoreNeeds eligible={s().eligible} />}>
                <StoreApplicationForm
                  draftKey={draftKey}
                  from={again() && s().application?.status === 'rejected' ? s().application : null}
                  onSent={sent}
                  onStale={() => {
                    void refetch();
                    void refreshSession();
                  }}
                />
              </Show>
            </Show>
          </Show>
        </div>
      )}
    </Show>
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
          <>
            <TournamentHero title={t(TITLE)} />
            <Show
              when={s().user}
              fallback={
                <div class='tm-apply'>
                  <section class='tm-box tm-paths'>
                    <PathRow path='community' joined={false} />
                    <PathRow path='store' joined={false} />
                  </section>
                  <SignedOutBox offer={s()} next='/apply' />
                </div>
              }
            >
              {user => <Applying user={user()} />}
            </Show>
          </>
        )}
      </SessionGate>
    </div>
  );
}
