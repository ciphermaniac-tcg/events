//! The site's footer is hidden in the app: its light and dark switch is
//! View > Appearance (`appearance.rs`), and on desktop its Terms, Privacy
//! and Feedback are in the Help menu. Android has no menu bar, so there the
//! account menu takes copies of those three links, made from the hidden
//! footer's own (already in the reader's language) each time it opens.

pub const CSS: &str = ".site-footer { display: none !important; }";

/// Copies the footer's Terms, Privacy and Feedback into the account menu,
/// above Sign out. A copy closes the menu as the menu's own links do, by
/// its button; the site's router follows it as it does every link.
#[cfg(any(mobile, test))]
pub const ACCOUNT_MENU_LINKS: &str = "\
const isKept = link => { const href = link.getAttribute('href') ?? ''; \
return href === '/terms' || href === '/privacy' || href.endsWith('/feedback'); }; \
const fill = () => { const menu = document.querySelector('.site-head .tm-acct-menu'); \
if (!menu || menu.querySelector('[data-app-link]')) return; \
const before = menu.lastElementChild; \
for (const link of document.querySelectorAll('.site-footer-links a')) { if (!isKept(link)) continue; \
const copy = link.cloneNode(true); copy.dataset.appLink = ''; \
copy.addEventListener('click', () => document.querySelector('.site-head .tm-acct-button')?.click()); \
menu.insertBefore(copy, before); } }; \
new MutationObserver(fill).observe(document.documentElement, { childList: true, subtree: true });";

#[cfg(test)]
mod tests {
    use super::{ACCOUNT_MENU_LINKS, CSS};

    #[test]
    fn hides_the_footer_and_keeps_its_links_in_the_account_menu() {
        assert!(CSS.contains(".site-footer { display: none !important; }"));
        assert!(ACCOUNT_MENU_LINKS.contains("href === '/terms'"));
        assert!(ACCOUNT_MENU_LINKS.contains("href.endsWith('/feedback')"));
        assert!(ACCOUNT_MENU_LINKS.contains(".tm-acct-menu"));
    }
}
