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
//! shrinks (`press.rs`), and the footer is hidden (`footer.rs`). Only the
//! site's own pages get it, and the site served to browsers is untouched.

mod footer;
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

const SITE_HOST: &str = "events.ciphermaniac.com";

/// Every rule the app adds to the site.
fn rules() -> String {
    [
        SELECTION,
        PLATFORM,
        footer::CSS,
        press::CSS,
        &system_font::css(),
    ]
    .join(" ")
}

/// A page script for the site's own pages: it adds `css` once the page
/// has its head, after the site's own stylesheets, and runs `then`.
pub fn site_script(css: &str, then: &str) -> String {
    let css = serde_json::Value::from(css);
    format!(
        "(() => {{ if (location.hostname !== '{SITE_HOST}') return; \
         const add = () => {{ const style = document.createElement('style'); \
         style.textContent = {css}; document.head.append(style); }}; \
         if (document.readyState === 'loading') {{ \
         document.addEventListener('DOMContentLoaded', add, {{ once: true }}); }} else {{ add(); }} \
         {then} }})();"
    )
}

/// The script each page of the app's windows runs first.
pub fn script() -> String {
    site_script(
        &rules(),
        &format!("document.documentElement.classList.add('in-app'); {PLATFORM_SCRIPT}"),
    )
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
