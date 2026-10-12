/** The site's name, and a page's title: its own name first, then the site's. */
export const SITE_NAME = 'Ciphermaniac Events';

export function pageTitle(name?: string): string {
  return name ? `${name} — ${SITE_NAME}` : SITE_NAME;
}
