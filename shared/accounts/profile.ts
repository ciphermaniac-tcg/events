export const PROFILE_LINKS = ['ciphermaniac', 'facebook', 'instagram', 'twitter', 'metafy'] as const;
export type ProfileLink = (typeof PROFILE_LINKS)[number];
export type ProfileLinks = Partial<Record<ProfileLink, string>>;
export interface ProfilePreferences {
  links: ProfileLinks;
}

export const PROFILE_LINK_LABELS: Record<ProfileLink, string> = {
  ciphermaniac: 'Ciphermaniac profile',
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'Twitter / X',
  metafy: 'Metafy'
};

const MAX_LINK_LENGTH = 512;
const HOSTS: Record<ProfileLink, readonly string[]> = {
  ciphermaniac: ['ciphermaniac.com', 'www.ciphermaniac.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  twitter: ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'],
  metafy: ['metafy.gg', 'www.metafy.gg']
};

function safeUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && !url.port;
}

/** Empty fields remove links; only HTTPS URLs on the chosen platform are accepted. */
export function validProfileLink(key: ProfileLink, value: string): boolean {
  if (!value) {
    return true;
  }
  if (value.length > MAX_LINK_LENGTH) {
    return false;
  }
  try {
    const url = new URL(value);
    if (!safeUrl(url) || !HOSTS[key].includes(url.hostname)) {
      return false;
    }
    return key === 'ciphermaniac' ? /^\/players\/\d+\/?$/u.test(url.pathname) : url.pathname !== '/';
  } catch {
    return false;
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readProfileLinks(value: unknown): ProfileLinks | null {
  if (!object(value) || Object.keys(value).some(key => !PROFILE_LINKS.includes(key as ProfileLink))) {
    return null;
  }
  const links: ProfileLinks = {};
  for (const key of PROFILE_LINKS) {
    const raw = value[key] ?? '';
    if (typeof raw !== 'string' || !validProfileLink(key, raw.trim())) {
      return null;
    }
    if (raw.trim()) {
      links[key] = raw.trim();
    }
  }
  return links;
}
