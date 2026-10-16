/**
 * /stores/:id/settings: a store's Managers change it. The sections are
 * listed down the left, as a settings app lists them, and the chosen one
 * fills the right (`?section=`, so each can be linked to): League nights (the
 * weekly nights and the dates that differ), Staff (StoreStaff), Details
 * (what the store tells players) and Displays (StoreDisplays, the big screen
 * presets). On a phone the list becomes a row of tabs over the section. Staff who are not Managers are sent to the store's
 * page; signed out, one box to sign in.
 */

import { SessionGate } from './SessionGate';
import { A, useSearchParams } from '@solidjs/router';
import { createEffect, createResource, createSignal, For, type JSX, Show, untrack } from 'solid-js';
import {
  dateIn,
  type LeagueNight,
  managesStore,
  type NightException,
  type StoreDetails
} from '../../../shared/accounts/stores';
import type { PublicStore } from '../../../shared/accounts/types';
import { Skeleton } from '../../components/Skeleton';
import { errorText, type SignInOffer } from '../../lib/tournament/api';
import { msg, t } from '../../lib/i18n';
import {
  byWeek,
  cleanDetails,
  detailsProblems,
  fetchStore,
  saveLeagueNights,
  saveStoreDetails
} from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { TournamentHero } from './Hero';
import { NightExceptions, WeeklyNights } from './LeagueNights';
import { refreshSession } from './session';
import { SignIn } from './SignIn';
import { StoreFields } from './StoreFields';
import { StoreDisplays } from './StoreDisplays';
import { ErrorLine } from './Field';
import { createSave, SaveBar } from './StoreSave';
import { StoreStaff } from './StoreStaff';
import '../../styles/pages/tournament-store-settings.css';
import { pageTitle } from '../../lib/title';

type Section = 'nights' | 'staff' | 'details' | 'displays';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'nights', label: msg('League nights') },
  { value: 'staff', label: msg('Staff') },
  { value: 'details', label: msg('Details') },
  { value: 'displays', label: msg('Displays') }
];

const readSection = (value: string | undefined): Section =>
  SECTIONS.find(section => section.value === value)?.value ?? 'nights';

const nightsProblem = (nights: readonly LeagueNight[], exceptions: readonly NightException[]) => {
  if (nights.some(night => !night.time)) {
    return t('Give each league night a start time');
  }
  return exceptions.some(item => !item.date || item.time === '')
    ? t('Give each date a day, and a time if it moved')
    : null;
};

function NightsSection(props: { store: PublicStore; onSaved: (store: PublicStore) => void }) {
  // Edits of a copy of the nights the page opened with, until they are saved.
  const [nights, setNights] = createSignal<LeagueNight[]>(untrack(() => byWeek(props.store.nights)));
  const [exceptions, setExceptions] = createSignal<NightException[]>(untrack(() => [...props.store.exceptions]));
  const save = createSave();
  const dirty = () =>
    JSON.stringify([nights(), exceptions()]) !== JSON.stringify([byWeek(props.store.nights), props.store.exceptions]);
  const today = () => dateIn(props.store.timeZone, Date.now());
  /** A date that named a night now removed applies to every night that day, rather than to none the server knows. */
  function changeNights(next: LeagueNight[]) {
    const kept = new Set(next.map(night => night.id));
    setNights(next);
    setExceptions(prev =>
      prev.map(item => (item.nightId !== null && !kept.has(item.nightId) ? { ...item, nightId: null } : item))
    );
  }
  function submit(event: Event) {
    event.preventDefault();
    const { store, onSaved } = props;
    const asked = { nights: nights(), exceptions: exceptions() };
    void save.run(async () => {
      const result = await saveLeagueNights(store.id, asked.nights, asked.exceptions);
      // Edits made while it was on its way stay, to save next.
      setNights(now => (now === asked.nights ? byWeek(result.nights) : now));
      setExceptions(now => (now === asked.exceptions ? result.exceptions : now));
      onSaved({ ...store, nights: result.nights, exceptions: result.exceptions });
    });
  }
  return (
    <form class='tm-store-section' aria-labelledby='store-nights-head' onSubmit={submit}>
      <h2 class='tm-subhead tm-box-head' id='store-nights-head'>
        {t('Every week')}
      </h2>
      <div class='tm-box tm-store-pane'>
        <WeeklyNights
          nights={nights()}
          country={props.store.country}
          storeName={props.store.name}
          onChange={changeNights}
        />
      </div>
      <h2 class='tm-subhead tm-box-head'>{t('Dates that differ')}</h2>
      <div class='tm-box tm-store-pane'>
        <NightExceptions exceptions={exceptions()} nights={nights()} today={today()} onChange={setExceptions} />
      </div>
      <SaveBar
        dirty={dirty()}
        busy={save.busy()}
        saved={save.saved()}
        error={save.error()}
        reason={nightsProblem(nights(), exceptions())}
      />
    </form>
  );
}

function DetailsSection(props: {
  store: PublicStore;
  contact: { phone: string; email: string };
  onSaved: (store: PublicStore, contact: { phone: string; email: string }) => void;
}) {
  const opened = (): StoreDetails => {
    const { name, address, city, region, postal, country, website, discord, details } = props.store;
    return { name, address, city, region, postal, country, website, discord, details, ...props.contact };
  };
  const [details, setDetails] = createSignal(untrack(opened));
  const [timeZone, setTimeZone] = createSignal(untrack(() => props.store.timeZone));
  const [checked, setChecked] = createSignal(false);
  const save = createSave();
  const dirty = () =>
    timeZone() !== props.store.timeZone || JSON.stringify(cleanDetails(details())) !== JSON.stringify(opened());
  function submit(event: Event) {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(detailsProblems(details())).length > 0) {
      return;
    }
    const { store: opening, onSaved } = props;
    const { lat, lon } = opening;
    const zone = timeZone();
    const change = {
      details: cleanDetails(details()),
      timeZone: zone,
      place: lat !== null && lon !== null ? { lat, lon, timeZone: zone } : null
    };
    void save.run(async () => {
      const { store } = await saveStoreDetails(opening.id, change);
      const { phone, email, ...shown } = store;
      onSaved({ ...opening, ...shown }, { phone, email });
      // The store's name is in the account's own list of stores too.
      void refreshSession();
    });
  }
  return (
    <form class='tm-store-section' aria-labelledby='store-details-head' noValidate onSubmit={submit}>
      <h2 class='tm-subhead tm-box-head' id='store-details-head'>
        {t('Details')}
      </h2>
      <div class='tm-box tm-store-pane'>
        <StoreFields
          id='store-field'
          details={details()}
          timeZone={timeZone()}
          checked={checked()}
          onChange={setDetails}
          onTimeZone={setTimeZone}
        />
      </div>
      <SaveBar dirty={dirty()} busy={save.busy()} saved={save.saved()} error={save.error()} />
    </form>
  );
}

/** The section list: down the left on a wide screen, a row of tabs on a phone. */
function SectionNav(props: { current: Section; onPick: (section: Section) => void }) {
  return (
    <nav class='tm-side-nav' aria-label={t('Store settings')}>
      <For each={SECTIONS}>
        {section => (
          <button
            type='button'
            classList={{ 'is-on': props.current === section.value }}
            aria-current={props.current === section.value ? 'page' : undefined}
            onClick={() => props.onPick(section.value)}
          >
            {t(section.label)}
          </button>
        )}
      </For>
    </nav>
  );
}

/** One section of the settings, mounted once it has been opened and hidden while another shows. */
function Pane(props: { of: Section; current: Section; opened: ReadonlySet<Section>; children: JSX.Element }) {
  return (
    <Show when={props.opened.has(props.of)}>
      <div hidden={props.current !== props.of}>{props.children}</div>
    </Show>
  );
}

function Settings(props: { id: string }) {
  const [params, setParams] = useSearchParams<{ section?: string }>();
  const [read, { mutate }] = createResource(() => props.id, fetchStore);
  const current = () => latestValue(read);
  const section = () => readSection(params.section);
  // A section stays mounted once opened, hidden while another shows, so its unsaved edits survive the switch.
  const [opened, setOpened] = createSignal<ReadonlySet<Section>>(new Set([untrack(section)]));
  createEffect(() => {
    const now = section();
    setOpened(prev => (prev.has(now) ? prev : new Set([...prev, now])));
  });
  createEffect(() => {
    const name = current()?.store.name;
    document.title = pageTitle(name ? t('{store} settings', { store: name }) : t('Store settings'));
  });
  const saved = (store: PublicStore, contact?: { phone: string; email: string }) =>
    mutate(prev => prev && { ...prev, store, ...(contact ? { contact } : {}) });
  return (
    <Show
      when={current()}
      fallback={
        <Show when={read.error} fallback={<Skeleton height='240px' />}>
          <ErrorLine message={errorText(read.error)} />
        </Show>
      }
    >
      {answer => (
        <Show
          when={managesStore(answer().role)}
          fallback={
            <>
              <TournamentHero title={answer().store.name} />
              <p class='tm-store-refused'>
                <span>{t('Only this store’s managers can change it.')}</span>{' '}
                <A href={`/stores/${answer().store.id}`}>{t('Store page')}</A>
              </p>
            </>
          }
        >
          <TournamentHero
            title={answer().store.name}
            tab='organizing'
            meta={
              <>
                <Show when={answer().store.leagueId} fallback={<span>{t('Unsanctioned store')}</span>}>
                  {id => <span class='tm-num'>{t('League {id}', { id: id() })}</span>}
                </Show>
                <span class='tm-store-dot' aria-hidden='true'>
                  ·
                </span>
                <A href={`/stores/${answer().store.id}`}>{t('Store page')}</A>
              </>
            }
            action={
              <A class='btn btn-primary' href={`/?${new URLSearchParams({ new: answer().store.id }).toString()}`}>
                {t('Start an event')}
              </A>
            }
          />
          <div class='tm-side-layout'>
            <SectionNav current={section()} onPick={value => setParams({ section: value })} />
            <div class='tm-side-content'>
              <Pane of='nights' current={section()} opened={opened()}>
                <NightsSection store={answer().store} onSaved={store => saved(store)} />
              </Pane>
              <Pane of='staff' current={section()} opened={opened()}>
                <StoreStaff storeId={answer().store.id} />
              </Pane>
              <Pane of='displays' current={section()} opened={opened()}>
                <StoreDisplays storeId={answer().store.id} />
              </Pane>
              <Pane of='details' current={section()} opened={opened()}>
                <DetailsSection
                  store={answer().store}
                  contact={answer().contact ?? { phone: '', email: '' }}
                  onSaved={saved}
                />
              </Pane>
            </div>
          </div>
        </Show>
      )}
    </Show>
  );
}

function SignedOut(props: { offer: SignInOffer; id: string }) {
  return (
    <>
      <TournamentHero title={t('Store settings')} />
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <SignIn offer={props.offer} next={`/stores/${props.id}/settings`} />
        </div>
      </section>
    </>
  );
}

export function StoreSettingsPage(props: { id: string }) {
  return (
    <div class='tm-page tm-store-settings-page'>
      <SessionGate>
        {s => (
          <Show when={s().user} fallback={<SignedOut offer={s()} id={props.id} />}>
            <Settings id={props.id} />
          </Show>
        )}
      </SessionGate>
    </div>
  );
}
