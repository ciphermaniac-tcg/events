/**
 * The admin page's Applications tab: the queue of pending ones, oldest
 * first, with a switch to the approved or rejected ones. Each shows the name
 * and POP ID it was sent with, the account as it is now, the store it asks
 * for, why, and the role approving gives the applicant in it, the
 * explanation, and a pending one takes Approve or Reject with an optional
 * note to the applicant. A
 * decided one stays in place, showing the decision, until the list is read
 * again.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import { NOTE_MAX } from '../../../shared/accounts/applications';
import { roleForRelationship } from '../../../shared/accounts/stores';
import type { AdminApplication, ApplicationStatus } from '../../../shared/accounts/types';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { ApiError, errorText } from '../../lib/tournament/api';
import { msg, t, tn } from '../../lib/i18n';
import { decideApplication, fetchApplications } from '../../lib/tournament/admin';
import { recountApplications } from './pendingApplications';
import { dayOf } from '../../lib/tournament/applications';
import { RELATIONSHIP_LABELS, STORE_ROLE_WORDS } from '../../lib/tournament/stores';
import { resolved } from '../../lib/resource';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine, RetryError } from './Field';
import '../../styles/pages/tournament-admin.css';

const STATUSES: { value: ApplicationStatus; label: string }[] = [
  { value: 'pending', label: msg('Pending') },
  { value: 'approved', label: msg('Approved') },
  { value: 'rejected', label: msg('Rejected') }
];

const DECIDED: Record<ApplicationStatus, string> = {
  pending: '',
  approved: msg('Approved'),
  rejected: msg('Rejected')
};

/** How many of the list are still in `status`, e.g. "3 pending". */
const COUNTS: Record<ApplicationStatus, (n: number) => string> = {
  pending: n => tn(n, '{n} pending', '{n} pending'),
  approved: n => tn(n, '{n} approved', '{n} approved'),
  rejected: n => tn(n, '{n} rejected', '{n} rejected')
};

/** One fact about an Application: its label at left, its value beside it. */
function Fact(props: { label: string; value: string | null | undefined }) {
  return (
    <Show when={props.value}>
      {value => (
        <div>
          <dt>{props.label}</dt>
          <dd>{value()}</dd>
        </div>
      )}
    </Show>
  );
}

/**
 * Approve or Reject, with the note the applicant sees. One another Admin
 * decided first, or its applicant withdrew, sends the list to be read again
 * (`onStale`).
 */
function Decide(props: {
  application: AdminApplication;
  onDecided: (decided: AdminApplication) => void;
  onStale: () => void;
}) {
  const [note, setNote] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      const { application } = await decideApplication(props.application.id, decision, note());
      recountApplications();
      props.onDecided(application);
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        props.onStale();
      }
    } finally {
      setBusy(false);
    }
  }
  const id = () => `note-${props.application.id}`;
  // Each row's controls are told apart by the applicant's name, its heading.
  const who = () => `app-${props.application.id}`;
  return (
    <div class='tm-app-decide'>
      <label class='tm-label' for={id()}>
        {t('Note to applicant')} <span class='muted tm-optional'>{t('optional')}</span>
      </label>
      <div class='tm-app-decide-row'>
        <input
          id={id()}
          class='tm-input'
          aria-describedby={who()}
          maxlength={NOTE_MAX}
          value={note()}
          onInput={event => setNote(event.currentTarget.value)}
        />
        <button
          type='button'
          class='btn btn-secondary tm-accept'
          aria-describedby={who()}
          disabled={busy()}
          onClick={() => void decide('approve')}
        >
          {t('Approve')}
        </button>
        <ConfirmAction
          class='btn btn-ghost'
          label={t('Reject')}
          question={t('Reject {name}?', {
            name: `${props.application.applied.firstName} ${props.application.applied.lastName}`
          })}
          danger
          disabled={busy()}
          onConfirm={() => void decide('reject')}
        />
      </div>
      <ErrorLine message={error()} />
    </div>
  );
}

function ApplicationRow(props: {
  application: AdminApplication;
  onDecided: (decided: AdminApplication) => void;
  onStale: () => void;
}) {
  const a = () => props.application;
  const decidedBy = () => {
    const at = a().decidedAt;
    if (!at) {
      return null;
    }
    const by = a().decidedBy?.name;
    return by ? t('{day} by {name}', { day: dayOf(at), name: by }) : dayOf(at);
  };
  return (
    <article class='tm-app'>
      <div class='tm-app-who'>
        <h3 id={`app-${a().id}`}>
          {a().applied.firstName} {a().applied.lastName}
          <Show when={DECIDED[a().status]}>{word => <span class='tm-flag'>{t(word())}</span>}</Show>
        </h3>
        <dl class='tm-app-facts'>
          <Fact label={t('POP ID')} value={a().applied.popId} />
          <Fact label={t('Account')} value={a().account.name} />
          <Fact label={t('Email')} value={a().account.email} />
          <Show when={a().store}>
            {store => (
              <>
                <Fact
                  label={t('Store')}
                  value={t('{store} · League {id}', { store: store().details.name, id: store().leagueId })}
                />
                <Fact label={t('Reason')} value={t(RELATIONSHIP_LABELS[store().relationship])} />
                <Fact label={t('Joins as')} value={t(STORE_ROLE_WORDS[roleForRelationship(store().relationship)])} />
              </>
            )}
          </Show>
          <Fact label={t('Sent')} value={dayOf(a().createdAt)} />
          <Fact label={t('Decided')} value={decidedBy()} />
        </dl>
      </div>
      <div class='tm-app-what'>
        <Show when={a().explanation} fallback={<p class='muted'>{t('No explanation')}</p>}>
          {text => <p class='tm-app-explanation'>{text()}</p>}
        </Show>
        <Show when={a().note}>
          {note => (
            <p class='tm-app-note'>
              <span class='muted'>{t('Note')}</span> {note()}
            </p>
          )}
        </Show>
        <Show when={a().status === 'pending'}>
          <Decide application={a()} onDecided={props.onDecided} onStale={props.onStale} />
        </Show>
      </div>
    </article>
  );
}

const EMPTY: Record<ApplicationStatus, string> = {
  pending: msg('No pending applications'),
  approved: msg('No approved applications'),
  rejected: msg('No rejected applications')
};

export function AdminApplications() {
  const [status, setStatus] = createSignal<ApplicationStatus>('pending');
  const [list, { refetch, mutate }] = createResource(status, wanted =>
    fetchApplications(wanted).then(answer => answer.applications)
  );
  const decided = (application: AdminApplication) =>
    mutate(prev => prev?.map(row => (row.id === application.id ? application : row)));
  return (
    <section class='tm-box tm-apps'>
      <div class='tm-box-bar'>
        <Segmented
          options={STATUSES.map(option => ({ ...option, label: t(option.label) }))}
          selected={status()}
          onSelect={setStatus}
          ariaLabel={t('Status')}
        />
        <span class='tm-grow' />
        {/* Decided in place, an Application leaves the count of those still in the queue. */}
        <Show when={resolved(list)}>
          {apps => (
            <span class='muted tm-num'>
              {COUNTS[status()](apps().filter(application => application.status === status()).length)}
            </span>
          )}
        </Show>
      </div>
      <Show
        when={resolved(list)}
        fallback={
          <Show when={list.state === 'errored'} fallback={<Skeleton height='160px' />}>
            <div class='tm-box-bar'>
              <RetryError error={list.error} onRetry={() => void refetch()} small />
            </div>
          </Show>
        }
      >
        {apps => (
          <Show when={apps().length > 0} fallback={<p class='tm-empty muted'>{t(EMPTY[status()])}</p>}>
            <For each={apps()}>
              {application => (
                <ApplicationRow application={application} onDecided={decided} onStale={() => void refetch()} />
              )}
            </For>
          </Show>
        )}
      </Show>
    </section>
  );
}
