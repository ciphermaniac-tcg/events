//! Makes the site behave like an app inside the desktop window: the arrow
//! cursor over controls, as on the Mac, and no selecting of buttons, tabs,
//! menus and headers by dragging across them. Text in content and fields
//! stays selectable. Only the site's own pages get it, and the site served
//! to browsers is untouched.

/// The rules, loose enough to hold across the site's pages: `!important`
/// wins over the site's own pointer cursors.
const RULES: &str = "\
a.btn, nav a, header a, button, summary, label, select, \
[role=\"button\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"option\"], [role=\"switch\"], \
input[type=\"checkbox\"], input[type=\"radio\"], input[type=\"range\"] { cursor: default !important; } \
button, summary, label, nav, header, th, .btn, .chip, \
[role=\"button\"], [role=\"tab\"], [role=\"tablist\"], [role=\"menu\"], [role=\"menuitem\"] \
{ -webkit-user-select: none; user-select: none; }";

const SITE_HOST: &str = "events.ciphermaniac.com";

/// The script each page of the main window runs first.
pub fn script() -> String {
    let rules = serde_json::Value::from(RULES);
    format!(
        "(() => {{ if (location.hostname !== '{SITE_HOST}') return; \
         const add = () => {{ const style = document.createElement('style'); \
         style.textContent = {rules}; document.head.append(style); \
         document.documentElement.classList.add('in-app'); }}; \
         if (document.readyState === 'loading') {{ \
         document.addEventListener('DOMContentLoaded', add, {{ once: true }}); }} else {{ add(); }} }})();"
    )
}

#[cfg(test)]
mod tests {
    use super::script;

    #[test]
    fn styles_only_the_sites_own_pages() {
        let script = script();
        assert!(script.contains("location.hostname !== 'events.ciphermaniac.com'"));
        assert!(script.contains("cursor: default !important"));
        assert!(script.contains("user-select: none"));
        assert!(
            !script.contains("input, textarea"),
            "fields stay selectable"
        );
    }
}
