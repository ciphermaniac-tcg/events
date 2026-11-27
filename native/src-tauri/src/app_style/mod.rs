//! Makes the site behave like an app inside the app's window. Buttons, tabs,
//! menus and headers can't be selected by dragging or long-pressing them;
//! text in content and fields stays selectable, and links and images stay in
//! the window rather than dragging out as addresses or files. The root also
//! takes the site's mode as its `color-scheme` (`body[data-mode]`, the
//! always-dark home page, else the system), so scrollbars, menus and pickers
//! stop drawing light in dark mode. On desktop, controls get the arrow
//! cursor, as on the Mac. On a phone, taps don't flash the webview's
//! highlight, and links and images raise no callout. Text is set in the
//! system's font (`system_font.rs`), a held control dims rather than
//! shrinks (`press.rs`), focus rings wait for the keyboard (`focus.rs`),
//! meta-line links drop their underline at rest (`links.rs`), and the
//! footer is hidden (`footer.rs`). The page behind an open dialog holds
//! still, as it does behind the site's sheets. Only the site's own pages
//! get it, and the site served to browsers is untouched.

mod focus;
mod footer;
mod links;
mod press;
mod system_font;

/// Every platform's rules, loose enough to hold across the site's pages.
const SELECTION: &str = "\
button, summary, label, nav, header, th, .btn, .chip, \
[role=\"button\"], [role=\"tab\"], [role=\"tablist\"], [role=\"menu\"], [role=\"menuitem\"] \
{ -webkit-user-select: none; user-select: none; } \
a, img { -webkit-user-drag: none; } \
:root { color-scheme: light; } \
:root:has(body[data-mode=\"dark\"]), :root:has(body.tm-home-mode) { color-scheme: dark; } \
@media (prefers-color-scheme: dark) { :root:has(body:not([data-mode])) { color-scheme: dark; } }";

/// A modal dialog leaves the page behind it in place, where the site would
/// let it scroll under the scrim.
const MODAL: &str = ":root:has(dialog:modal) { overflow: hidden; }";

/// `!important` wins over the site's own pointer cursors.
#[cfg(desktop)]
const PLATFORM: &str = "\
a.btn, nav a, header a, button, summary, label, select, \
[role=\"button\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"option\"], [role=\"switch\"], \
input[type=\"checkbox\"], input[type=\"radio\"], input[type=\"range\"] { cursor: default !important; }";

/// The highlight is inherited, so the root turns it off everywhere.
#[cfg(mobile)]
const PLATFORM: &str = "\
:root { -webkit-tap-highlight-color: transparent; } \
a, img { -webkit-touch-callout: none; }";

/// What each platform runs besides: on a phone, the footer's links in the
/// account menu, as there is no menu bar to hold them.
#[cfg(desktop)]
const PLATFORM_SCRIPT: &str = "";
#[cfg(mobile)]
const PLATFORM_SCRIPT: &str = footer::ACCOUNT_MENU_LINKS;

const SITE_HOST: &str = "botan.tail843dce.ts.net";

/// Every rule the app adds to the site.
fn rules() -> String {
    [
        SELECTION,
        MODAL,
        PLATFORM,
        focus::CSS,
        footer::CSS,
        links::CSS,
        press::CSS,
        &system_font::css(),
    ]
    .join(" ")
}

/// A page script for the site's own pages: once the page has its head, it
/// adds `css` after the site's own stylesheets and marks the root `in-app`;
/// before then the page may have no root at all. It runs `then` at once.
pub fn site_script(css: &str, then: &str) -> String {
    let css = serde_json::Value::from(css);
    format!(
        "(() => {{ if (location.hostname !== '{SITE_HOST}') return; \
         const add = () => {{ const style = document.createElement('style'); \
         style.textContent = {css}; document.head.append(style); \
         document.documentElement.classList.add('in-app'); }}; \
         if (document.readyState === 'loading') {{ \
         document.addEventListener('DOMContentLoaded', add, {{ once: true }}); }} else {{ add(); }} \
         {then} }})();"
    )
}

/// The script each page of the app's windows runs first.
pub fn script() -> String {
    site_script(&rules(), &format!("{} {PLATFORM_SCRIPT}", focus::SCRIPT))
}

#[cfg(test)]
mod tests {
    use super::script;

    #[test]
    fn styles_only_the_sites_own_pages() {
        let script = script();
        assert!(script.contains("location.hostname !== 'events.ciphermaniac.com'"));
        assert!(script.contains("user-select: none"));
        assert!(script.contains("a, img { -webkit-user-drag: none; }"));
        assert!(script.contains(r#":root:has(body[data-mode=\"dark\"])"#));
        assert!(script.contains("color-scheme: dark"));
        assert!(
            !script.contains("input, textarea"),
            "fields stay selectable"
        );
    }

    #[test]
    fn holds_the_page_still_behind_a_dialog() {
        assert!(script().contains(":root:has(dialog:modal) { overflow: hidden; }"));
    }

    #[test]
    fn waits_for_the_pages_root() {
        let script = super::site_script("", super::footer::ACCOUNT_MENU_LINKS);
        let (before, add) = script.split_once("const add = () => {").unwrap();
        let (_, after) = add.split_once("}; if (document.readyState").unwrap();
        assert!(!before.contains("documentElement") && !after.contains("documentElement"));
        assert!(script.contains("classList.add('in-app')"));
    }

    #[cfg(desktop)]
    #[test]
    fn gives_controls_the_arrow_cursor_on_desktop() {
        assert!(script().contains("cursor: default !important"));
    }

    #[cfg(mobile)]
    #[test]
    fn turns_off_the_tap_highlight_on_a_phone() {
        let script = script();
        assert!(script.contains("-webkit-tap-highlight-color: transparent"));
        assert!(!script.contains("cursor"));
    }
}
