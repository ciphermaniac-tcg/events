import { createResource, createSignal, For, Show, untrack } from 'solid-js';
import {
  PROFILE_LINK_LABELS,
  PROFILE_LINKS,
  type ProfileLinks,
  validProfileLink
} from '../../../shared/accounts/profile';
import { errorText, fetchProfilePreferences, saveProfileLinks } from '../../lib/tournament/api';
import { resolved } from '../../lib/resource';
import { t } from '../../lib/i18n';
import { ErrorLine, Field } from './Field';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import '../../styles/pages/tournament-profile.css';

function LinksForm(props: { links: ProfileLinks }) {
  const [links, setLinks] = createSignal<ProfileLinks>(untrack(() => ({ ...props.links })));
  const [busy, setBusy] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [touched, setTouched] = createSignal(false);
  const problem = (key: (typeof PROFILE_LINKS)[number]) =>
    touched() && !validProfileLink(key, (links()[key] ?? '').trim()) ? t('Enter a valid HTTPS profile URL') : undefined;
  async function save(event: SubmitEvent) {
    event.preventDefault();
    setTouched(true);
    if (busy() || PROFILE_LINKS.some(key => problem(key))) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const answer = await saveProfileLinks(links());
      setLinks(answer.links);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={event => void save(event)} class='tm-profile-links-form'>
      <For each={PROFILE_LINKS}>
        {key => (
          <Field id={`profile-link-${key}`} label={t(PROFILE_LINK_LABELS[key])} error={problem(key)}>
            <input
              id={`profile-link-${key}`}
              class='tm-input'
              type='url'
              maxLength={512}
              value={links()[key] ?? ''}
              aria-invalid={Boolean(problem(key))}
              aria-describedby={problem(key) ? `profile-link-${key}-error` : undefined}
              onInput={event => {
                setLinks(prev => ({ ...prev, [key]: event.currentTarget.value }));
                setSaved(false);
              }}
            />
          </Field>
        )}
      </For>
      <div class='tm-profile-form-actions'>
        <button type='submit' class='btn btn-primary' disabled={busy()}>
          {busy() ? t('Saving…') : t('Save links')}
        </button>
        <Show when={saved()}>
          <span role='status' class='muted'>
            {t('Saved')}
          </span>
        </Show>
      </div>
      <ErrorLine message={error()} />
    </form>
  );
}

export function ProfileLinksForm() {
  const [preferences, { refetch }] = createResource(fetchProfilePreferences);
  return (
    <Show
      when={resolved(preferences)}
      fallback={
        <Show when={preferences.error} fallback={<Skeleton height='240px' />}>
          <ErrorLine message={errorText(preferences.error)} />
          <button type='button' class='btn btn-secondary' onClick={() => void refetch()}>
            {t('Retry')}
          </button>
        </Show>
      }
    >
      {found => <LinksForm links={found().links} />}
    </Show>
  );
}
