/**
 * The Application for a store, under the apply page's Store row. The league
 * comes first, as its ID or its pokemon.com page: looking it up fills in what
 * the event locator knows of the store (name, address, place, time zone), or,
 * when it knows nothing, leaves the fields to type. A league that already has
 * a store goes no further. Then why the applicant applies for the store, their
 * confirmation that they are certified, the store's details and weekly league
 * nights, and optionally a note. A refusal over the profile
 * or a pending Application rereads the account (`onStale`). What is typed
 * is kept for the tab (`draftKey`), so a reload opens it again as it was left.
 * Apply again starts from the application it follows (`from`).
 */

import { createEffect, createSignal, For, Show, untrack } from 'solid-js';
import { EXPLANATION_MAX } from '../../../shared/accounts/applications';
import {
  addressOf,
  type LeagueNight,
  readLeagueId,
  type Relationship,
  RELATIONSHIPS,
  type StoreDetails,
  type StorePlace
} from '../../../shared/accounts/stores';
import type { LeagueFound, MyApplication } from '../../../shared/accounts/types';
import { ApiError, errorText } from '../../lib/tournament/api';
import { t } from '../../lib/i18n';
import {
  browserZone,
  cleanDetails,
  detailsFromLeague,
  detailsProblems,
  emptyDetails,
  fetchLeague,
  RELATIONSHIP_LABELS,
  sendStoreApplication,
  zoneName
} from '../../lib/tournament/stores';
import { ErrorLine, Field } from './Field';
import { WeeklyNights } from './LeagueNights';
import { StoreFields } from './StoreFields';

/** Where the league lookup stands. */
type Lookup =
  | { kind: 'idle' }
  | { kind: 'looking' }
  | { kind: 'found'; leagueId: string; league: LeagueFound }
  | { kind: 'unknown'; leagueId: string }
  /** The league an application sent before asked for, and where it put the store. */
  | { kind: 'again'; leagueId: string; place: StorePlace | null }
  | { kind: 'refused'; message: string };

/** A lookup with its league: found, left to type or applied for before. The form is open on it. */
type League = Extract<Lookup, { leagueId: string }>;

const leagueOf = (lookup: Lookup): League | null =>
  lookup.kind === 'found' || lookup.kind === 'unknown' || lookup.kind === 'again' ? lookup : null;

/** Where the store is, as its lookup found it or the application before had it, in the zone now picked. */
function placeOf(league: League, timeZone: string): StorePlace | null {
  const at = league.kind === 'found' ? league.league : league.kind === 'again' ? league.place : null;
  return at && { lat: at.lat, lon: at.lon, timeZone };
}

/** What is typed, as the tab keeps it (sessionStorage: it holds the store's private phone and email). */
interface Draft {
  lookup: Lookup;
  details: StoreDetails;
  timeZone: string;
  relationship: Relationship | '';
  certified: boolean;
  nights: LeagueNight[];
  explanation: string;
}

export const applicationDraftKey = (account: string) => `cm-store-application:${encodeURIComponent(account)}`;

/** What an application sent before fills in, for Apply again: all of it but the profile's own parts. */
function sentDraft(sent: MyApplication | null | undefined): Partial<Draft> {
  const store = sent?.store;
  return store
    ? {
        lookup: { kind: 'again', leagueId: store.leagueId, place: store.place },
        details: store.details,
        timeZone: store.timeZone,
        relationship: store.relationship,
        certified: true,
        nights: store.nights,
        explanation: sent.explanation
      }
    : {};
}

/** The draft kept under `key`; empty when there is none, or storage is off. */
export function readApplicationDraft(key: string): Partial<Draft> {
  try {
    return (JSON.parse(sessionStorage.getItem(key) ?? '{}') as Partial<Draft> | null) ?? {};
  } catch {
    return {};
  }
}

function keepDraft(key: string, draft: Draft | null) {
  try {
    if (draft) {
      sessionStorage.setItem(key, JSON.stringify(draft));
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    // The form still works, kept only in memory.
  }
}

/** What the locator found, as the applicant checks it against their store. */
function Found(props: { league: LeagueFound }) {
  const details = () => detailsFromLeague(props.league);
  return (
    <div class='tm-apply-found' role='status'>
      <strong>{details().name}</strong>
      <span class='muted'>{addressOf(details())}</span>
      <span class='muted tm-num'>
        {t('League {id} · {zone}', { id: props.league.leagueId, zone: zoneName(props.league.timeZone) })}
      </span>
    </div>
  );
}

/** The league field and its lookup; the answer goes to `onLookup`. */
function LeagueField(props: { lookup: Lookup; onLookup: (lookup: Lookup) => void }) {
  const [typed, setTyped] = createSignal(untrack(() => leagueOf(props.lookup)?.leagueId ?? ''));
  async function look() {
    const leagueId = readLeagueId(typed());
    if (!leagueId) {
      props.onLookup({ kind: 'refused', message: t('Enter the league ID, or paste its pokemon.com page') });
      return;
    }
    props.onLookup({ kind: 'looking' });
    try {
      const answer = await fetchLeague(leagueId);
      if (answer.taken) {
        props.onLookup({ kind: 'refused', message: t('That league already has a store') });
      } else {
        props.onLookup(
          answer.league ? { kind: 'found', leagueId, league: answer.league } : { kind: 'unknown', leagueId }
        );
      }
    } catch (err) {
      // Without the lookup the application still goes: the details are typed instead.
      props.onLookup(
        err instanceof ApiError && err.status === 400
          ? { kind: 'refused', message: errorText(err) }
          : { kind: 'unknown', leagueId }
      );
    }
  }
  /** Another league typed after a lookup puts the form away until that one is looked up. */
  function typing(value: string) {
    setTyped(readLeagueId(value) ?? value);
    const current = leagueOf(props.lookup);
    if (current && readLeagueId(value) !== current.leagueId) {
      props.onLookup({ kind: 'idle' });
    }
  }
  const refusal = () => {
    const current = props.lookup;
    return current.kind === 'refused' ? current.message : undefined;
  };
  return (
    <Field id='apply-league' label={t('League ID or pokemon.com league page')} error={refusal()}>
      {control => (
        <span class='tm-apply-league'>
          <input
            {...control}
            class='tm-input'
            autocomplete='off'
            value={typed()}
            onInput={e => typing(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void look();
              }
            }}
          />
          <button
            type='button'
            class='btn btn-secondary'
            disabled={props.lookup.kind === 'looking' || !typed().trim()}
            onClick={() => void look()}
          >
            {props.lookup.kind === 'looking' ? t('Looking up') : t('Look up')}
          </button>
        </span>
      )}
    </Field>
  );
}

export function StoreApplicationForm(props: {
  draftKey: string;
  from?: MyApplication | null;
  onSent: (sent: MyApplication) => void;
  onStale: () => void;
}) {
  // What this tab kept goes over what was sent before, as it was typed since.
  const draft = untrack(() => ({ ...sentDraft(props.from), ...readApplicationDraft(props.draftKey) }));
  // A lookup that was on its way, or refused, starts over.
  const [lookup, setLookup] = createSignal<Lookup>(
    draft.lookup && leagueOf(draft.lookup) ? draft.lookup : { kind: 'idle' }
  );
  const [details, setDetails] = createSignal<StoreDetails>(draft.details ?? emptyDetails());
  const [timeZone, setTimeZone] = createSignal(draft.timeZone ?? browserZone());
  const [relationship, setRelationship] = createSignal<Relationship | ''>(draft.relationship ?? '');
  const [certified, setCertified] = createSignal(draft.certified ?? false);
  const [nights, setNights] = createSignal<LeagueNight[]>(draft.nights ?? []);
  const [explanation, setExplanation] = createSignal(draft.explanation ?? '');
  createEffect(() =>
    keepDraft(props.draftKey, {
      lookup: lookup(),
      details: details(),
      timeZone: timeZone(),
      relationship: relationship(),
      certified: certified(),
      nights: nights(),
      explanation: explanation()
    })
  );
  const [sending, setSending] = createSignal(false);
  const [checked, setChecked] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const league = () => leagueOf(lookup());
  const known = () => {
    const current = lookup();
    return current.kind === 'found' ? current.league : null;
  };
  // The locator knew nothing of the league, or could not be asked: the details are typed instead.
  const unknown = () => {
    const current = lookup();
    return current.kind === 'unknown' ? current.leagueId : null;
  };
  function looked(next: Lookup) {
    setLookup(next);
    if (next.kind === 'found') {
      setDetails(prev => ({ ...prev, ...detailsFromLeague(next.league) }));
      setTimeZone(next.league.timeZone);
    }
  }
  // Each problem shows under its own field once the form has tried to send; the store's details mark theirs (StoreFields).
  const relationshipProblem = () =>
    checked() && !relationship() ? t('Say why you are applying for the store') : undefined;
  const certifiedProblem = () =>
    checked() && !certified() ? t('Confirm you are a certified organizer, or work with one') : undefined;
  const nightsProblem = () =>
    checked() && nights().some(night => !night.time) ? t('Give each league night a start time') : undefined;
  const ready = () =>
    Boolean(relationship()) &&
    certified() &&
    Object.keys(detailsProblems(details())).length === 0 &&
    nights().every(night => night.time);
  let form: HTMLFormElement | undefined;

  async function send(event: Event) {
    event.preventDefault();
    const found = league();
    setChecked(true);
    setError(null);
    if (!ready()) {
      // As Settings does: a refused send leaves focus on the first field to fix.
      form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (!found || sending()) {
      return;
    }
    setSending(true);
    const place = placeOf(found, timeZone());
    try {
      const { application } = await sendStoreApplication(
        {
          leagueId: found.leagueId,
          details: cleanDetails(details()),
          place,
          timeZone: timeZone(),
          relationship: relationship() as Relationship,
          certified: true,
          nights: nights()
        },
        explanation().trim()
      );
      keepDraft(props.draftKey, null);
      props.onSent(application);
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError && (err.body?.profile === true || err.status === 409)) {
        props.onStale();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <form ref={form} class='tm-apply-store' noValidate onSubmit={event => void send(event)}>
      <LeagueField lookup={lookup()} onLookup={looked} />
      <Show when={league()}>
        <>
          <Show when={known()}>{found => <Found league={found()} />}</Show>
          <Show when={unknown()}>
            {id => (
              <p class='muted tm-apply-unknown' role='status'>
                {t('We couldn’t find league {id}. Enter the store’s details below.', { id: id() })}
              </p>
            )}
          </Show>
          <Field
            id='apply-relationship'
            label={t('Why are you applying for this store?')}
            error={relationshipProblem()}
          >
            {control => (
              <select
                {...control}
                class='tm-select tm-select-full'
                onChange={e => setRelationship(e.currentTarget.value as Relationship | '')}
              >
                <option value='' selected={relationship() === ''}>
                  {t('Choose')}
                </option>
                <For each={RELATIONSHIPS}>
                  {value => (
                    <option value={value} selected={relationship() === value}>
                      {t(RELATIONSHIP_LABELS[value])}
                    </option>
                  )}
                </For>
              </select>
            )}
          </Field>
          <div class='tm-field'>
            <label class='tm-check tm-apply-certified'>
              <input
                type='checkbox'
                checked={certified()}
                aria-invalid={certifiedProblem() ? 'true' : undefined}
                aria-describedby={certifiedProblem() ? 'apply-certified-error' : undefined}
                onChange={e => setCertified(e.currentTarget.checked)}
              />
              {t('I’m a certified Play! Pokémon organizer, or work with one')}
            </label>
            <Show when={certifiedProblem()}>
              {text => (
                <span class='tm-error' id='apply-certified-error'>
                  {text()}
                </span>
              )}
            </Show>
          </div>
          <h2 class='tm-subhead tm-apply-head'>{t('Store')}</h2>
          <StoreFields
            id='apply-store'
            part='shown'
            details={details()}
            timeZone={timeZone()}
            checked={checked()}
            onChange={setDetails}
            onTimeZone={setTimeZone}
          />
          {/* As store settings group them: the phone and email players never see. */}
          <h2 class='tm-subhead tm-apply-head'>{t('Private, for Ciphermaniac admins')}</h2>
          <StoreFields
            id='apply-store'
            part='contact'
            details={details()}
            timeZone={timeZone()}
            checked={checked()}
            onChange={setDetails}
            onTimeZone={setTimeZone}
          />
          <h2 class='tm-subhead tm-apply-head'>{t('League nights')}</h2>
          <WeeklyNights
            nights={nights()}
            country={details().country}
            storeName={details().name}
            checked={checked()}
            onChange={setNights}
          />
          <Show when={nightsProblem()}>{text => <span class='tm-error'>{text()}</span>}</Show>
          <h2 class='tm-subhead tm-apply-head'>{t('For the admin')}</h2>
          <div class='tm-field'>
            <label class='tm-label' for='apply-explanation'>
              {t('Note')} <span class='muted tm-optional'>{t('optional')}</span>
            </label>
            <textarea
              id='apply-explanation'
              class='tm-input tm-textarea'
              maxlength={EXPLANATION_MAX}
              value={explanation()}
              onInput={event => setExplanation(event.currentTarget.value)}
            />
            <span class='muted tm-num tm-apply-count'>
              {explanation().length} / {EXPLANATION_MAX}
            </span>
          </div>
          <div class='tm-apply-foot'>
            <button type='submit' class='btn btn-primary' disabled={sending()}>
              {t('Send application')}
            </button>
            <ErrorLine message={error()} />
          </div>
        </>
      </Show>
    </form>
  );
}
