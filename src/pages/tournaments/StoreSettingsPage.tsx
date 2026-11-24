/**
 * /stores/:id/settings: a store's Managers change it. The sections are
 * listed down the left, as a settings app lists them, and the chosen one
 * fills the right (`?section=`, so each can be linked to): League nights (the
 * weekly nights and the dates that differ), Staff (StoreStaff), Details
 * (what the store tells players) and Displays (StoreDisplays, the big screen
 * presets). On a phone the list becomes a row of tabs over the section. Staff who are not Managers are sent to the store's
 * page; signed out, one box to sign in.
 */

import { SessionGate, StoreLoadError } from './SessionGate';
import { A, type BeforeLeaveEventArgs, useBeforeLeave, useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  untrack
} from 'solid-js';
import {
  dateIn,
  type LeagueNight,
  managesStore,
  type NightException,
  type StoreDetails
} from '../../../shared/accounts/stores';
import type { PublicStore } from '../../../shared/accounts/types';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { type SignInOffer } from '../../lib/tournament/api';
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
import { createAction } from './action';
import { SaveBar } from './StoreSave';
import { ConfirmDialog } from './ConfirmAction';
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

/**
 * Whether a leave goes to another page, rather than to another section of
 * this one (`?section=`). The browser's Back and Forward come as a number,
 * asked once the address has already moved to where they go.
 */
const leavesPage = (event: BeforeLeaveEventArgs) =>
  new URL(typeof event.to === 'number' ? location.href : event.to, location.href).pathname !== event.from.pathname;

/** While a section has edits not yet saved, leaving the page asks first in a dialog, and closing the tab as the browser does. */
function LeaveGuard(props: { dirty: boolean }) {
  const [leave, setLeave] = createSignal<(() => void) | null>(null);
  const unload = (event: BeforeUnloadEvent) => {
    if (props.dirty) {
      event.preventDefault();
    }
  };
  window.addEventListener('beforeunload', unload);
  onCleanup(() => window.removeEventListener('beforeunload', unload));
  useBeforeLeave(event => {
    if (props.dirty && leavesPage(event)) {
      event.preventDefault();
      setLeave(() => () => event.retry(true));
    }
  });
  return (
    <ConfirmDialog
      open={leave() !== null}
      question={t('Leave without saving?')}
      scope={t('Your changes will be lost.')}
      confirmLabel={t('Leave')}
      danger
      onConfirm={() => leave()?.()}
      onClose={() => setLeave(null)}
    />
  );
}

function NightsSection(props: {
  store: PublicStore;
  onSaved: (store: PublicStore) => void;
  onDirty: (dirty: boolean) => void;
}) {
  // Edits of a copy of the nights the page opened with, until they are saved.
  const [nights, setNights] = createSignal<LeagueNight[]>(untrack(() => byWeek(props.store.nights)));
  const [exceptions, setExceptions] = createSignal<NightException[]>(untrack(() => [...props.store.exceptions]));
  const save = createAction();
  const dirty = () =>
    JSON.stringify([nights(), exceptions()]) !== JSON.stringify([byWeek(props.store.nights), props.store.exceptions]);
  // For the page's one LeaveGuard.
  createEffect(() => props.onDirty(dirty()));
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
      <h2 class='tm-subhead tm-box-head'>{t('Off nights and changes')}</h2>
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
  onDirty: (dirty: boolean) => void;
}) {
  const opened = (): StoreDetails => {
    const { name, address, city, region, postal, country, website, discord, details } = props.store;
    return { name, address, city, region, postal, country, website, discord, details, ...props.contact };
  };
  const [details, setDetails] = createSignal(untrack(opened));
  const [timeZone, setTimeZone] = createSignal(untrack(() => props.store.timeZone));
  const [checked, setChecked] = createSignal(false);
  const save = createAction();
  const dirty = () =>
    timeZone() !== props.store.timeZone || JSON.stringify(cleanDetails(details())) !== JSON.stringify(opened());
  // For the page's one LeaveGuard.
  createEffect(() => props.onDirty(dirty()));
  function submit(event: Event) {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(detailsProblems(details())).length > 0) {
      // As the store application does: focus goes to the first field to fix.
      (event.currentTarget as HTMLFormElement).querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
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
          part='shown'
          details={details()}
          timeZone={timeZone()}
          checked={checked()}
          onChange={setDetails}
          onTimeZone={setTimeZone}
        />
      </div>
      <h2 class='tm-subhead tm-box-head'>{t('Private, for Ciphermaniac admins')}</h2>
      <div class='tm-box tm-store-pane'>
        <StoreFields
          id='store-field'
          part='contact'
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
function SectionNav(props: { current: Section }) {
  let nav: HTMLElement | undefined;
  // On a phone, where the list is a row of tabs, the open one is brought into the row.
  createEffect(() => {
    void props.current;
    // Scrolled by hand: scrollIntoView would move where the first Tab press starts, past the skip link.
    const on = nav?.querySelector('.is-on')?.getBoundingClientRect();
    const strip = nav?.getBoundingClientRect();
    if (nav && on && strip) {
      nav.scrollLeft += Math.min(0, on.left - strip.left) || Math.max(0, on.right - strip.right);
    }
  });
  return (
    <nav ref={nav} class='tm-side-nav' aria-label={t('Store settings')}>
      <For each={SECTIONS}>
        {section => (
          <a
            href={`?section=${section.value}`}
            noScroll
            classList={{ 'is-on': props.current === section.value }}
            aria-current={props.current === section.value ? 'page' : undefined}
          >
            {t(section.label)}
          </a>
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
  const [params] = useSearchParams<{ section?: string }>();
  const [read, { refetch, mutate }] = createResource(() => props.id, fetchStore);
  const current = () => latestValue(read);
  const section = () => readSection(params.section);
  // A section stays mounted once opened, hidden while another shows, so its unsaved edits survive the switch.
  const opened = createMemo<ReadonlySet<Section>>(
    prev => (prev.has(section()) ? prev : new Set([...prev, section()])),
    new Set()
  );
  createEffect(() => {
    const name = current()?.store.name;
    document.title = pageTitle(name ? t('{store} settings', { store: name }) : t('Store settings'));
  });
  const saved = (store: PublicStore, contact?: { phone: string; email: string }) =>
    mutate(prev => prev && { ...prev, store, ...(contact ? { contact } : {}) });
  // One guard for the page, outside the hidden sections, so its question never opens where it cannot be seen.
  const [edited, setEdited] = createSignal({ nights: false, details: false });
  const edit = (part: 'nights' | 'details') => (dirty: boolean) => setEdited(prev => ({ ...prev, [part]: dirty }));
  return (
    <Show
      when={current()}
      fallback={
        <Show when={read.error} fallback={<Skeleton height='240px' />}>
          <StoreLoadError error={read.error} onRetry={() => void refetch()} />
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
            <SectionNav current={section()} />
            <div class='tm-side-content'>
              <Pane of='nights' current={section()} opened={opened()}>
                <NightsSection store={answer().store} onSaved={store => saved(store)} onDirty={edit('nights')} />
              </Pane>
              <Pane of='staff' current={section()} opened={opened()}>
                <StoreStaff storeId={answer().store.id} storeName={answer().store.name} />
              </Pane>
              <Pane of='displays' current={section()} opened={opened()}>
                <StoreDisplays storeId={answer().store.id} />
              </Pane>
              <Pane of='details' current={section()} opened={opened()}>
                <DetailsSection
                  store={answer().store}
                  contact={answer().contact ?? { phone: '', email: '' }}
                  onSaved={saved}
                  onDirty={edit('details')}
                />
              </Pane>
            </div>
          </div>
          <LeaveGuard dirty={edited().nights || edited().details} />
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
