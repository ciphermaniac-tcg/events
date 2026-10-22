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
import { createAction } from './action';

function LinksForm(props: { links: ProfileLinks }) {
  const [links, setLinks] = createSignal<ProfileLinks>(untrack(() => ({ ...props.links })));
  const action = createAction();
  const [touched, setTouched] = createSignal(false);
  const problem = (key: (typeof PROFILE_LINKS)[number]) =>
    touched() && !validProfileLink(key, (links()[key] ?? '').trim()) ? t('Enter a valid HTTPS profile URL') : undefined;
  async function save(event: SubmitEvent) {
    event.preventDefault();
    setTouched(true);
    if (PROFILE_LINKS.some(key => problem(key))) {
      return;
    }
    const asked = links();
    const answer = await action.run(() => saveProfileLinks(asked));
    if (answer) {
      setLinks(answer.links);
    }
  }
  return (
    <form onSubmit={event => void save(event)} class='tm-profile-links-form'>
      <For each={PROFILE_LINKS}>
        {key => (
          <Field id={`profile-link-${key}`} label={t(PROFILE_LINK_LABELS[key])} error={problem(key)}>
            {control => (
              <input
                {...control}
                class='tm-input'
                type='url'
                maxLength={512}
                value={links()[key] ?? ''}
                onInput={event => {
                  setLinks(prev => ({ ...prev, [key]: event.currentTarget.value }));
                  action.clear();
                }}
              />
            )}
          </Field>
        )}
      </For>
      <div class='tm-profile-form-actions'>
        <button type='submit' class='btn btn-primary' disabled={action.busy()}>
          {action.busy() ? t('Saving…') : t('Save links')}
        </button>
        <Show when={action.saved()}>
          <span role='status' class='muted'>
            {t('Saved')}
          </span>
        </Show>
      </div>
      <ErrorLine message={action.error()} />
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
            {t('Try again')}
          </button>
        </Show>
      }
    >
      {found => <LinksForm links={found().links} />}
    </Show>
  );
}
