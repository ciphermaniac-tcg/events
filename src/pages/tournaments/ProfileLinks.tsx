import { For } from 'solid-js';
import { type ProfileLinks as Links, PROFILE_LINK_LABELS, PROFILE_LINKS } from '../../../shared/accounts/profile';
import { t } from '../../lib/i18n';

export function ProfileLinks(props: { links: Links }) {
  return (
    <nav class='tm-profile-links' aria-label={t('Profile links')}>
      <For each={PROFILE_LINKS.filter(key => props.links[key])}>
        {key => (
          <a
            href={props.links[key]}
            aria-label={t(PROFILE_LINK_LABELS[key])}
            title={t(PROFILE_LINK_LABELS[key])}
            rel='noopener noreferrer'
            target='_blank'
          >
            <span
              class='tm-social-icon'
              style={{ 'mask-image': key === 'ciphermaniac' ? 'url(/logo.svg)' : `url(/img/socials/${key}.svg)` }}
              aria-hidden='true'
            />
          </a>
        )}
      </For>
    </nav>
  );
}
