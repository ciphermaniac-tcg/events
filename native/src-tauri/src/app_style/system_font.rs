//! The system's own font in place of the site's Inter: SF Pro on the Mac,
//! Segoe UI Variable on Windows (its Display cut for headings), Roboto on
//! Android, and the desktop's font on Linux. Inter's stylistic sets go with
//! it, and bars, tabs, buttons and menus drop Inter's tightened tracking.
//! Figures stay tabular where the site asks for them, since it does so with
//! `font-variant-numeric`, which every one of these fonts has.

#[cfg(target_os = "macos")]
const TEXT: &str = "-apple-system, BlinkMacSystemFont, system-ui, sans-serif";
#[cfg(target_os = "macos")]
const HEADINGS: &str = TEXT;

#[cfg(windows)]
const TEXT: &str = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
#[cfg(windows)]
const HEADINGS: &str = "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif";

#[cfg(target_os = "android")]
const TEXT: &str = "Roboto, system-ui, sans-serif";
#[cfg(target_os = "android")]
const HEADINGS: &str = TEXT;

#[cfg(not(any(target_os = "macos", windows, target_os = "android")))]
const TEXT: &str = "system-ui, sans-serif";
#[cfg(not(any(target_os = "macos", windows, target_os = "android")))]
const HEADINGS: &str = TEXT;

/// The app's chrome, less the sign-in buttons, which keep their providers'
/// own lettering.
const CHROME: &str = "\
:is(.site-head, .site-head *, .tabs, .tabs *, [role=\"tablist\"], [role=\"tablist\"] *, \
.tm-tabbar, .tm-tabbar *, .btn, button, [role=\"menu\"], [role=\"menu\"] *, \
.tm-box-bar h3, .tm-sheet-head h2):not(.tm-sso, .tm-sso *)";

/// The rules. `!important` holds them over stylesheets a page loads later.
pub fn css() -> String {
    format!(
        "body {{ font-family: {TEXT} !important; font-feature-settings: normal; }} \
         :is(h1, h2, h3, h4, h5, h6) {{ font-family: {HEADINGS} !important; }} \
         {CHROME} {{ font-feature-settings: normal; letter-spacing: 0 !important; }}"
    )
}

#[cfg(test)]
mod tests {
    use super::css;

    #[test]
    fn sets_the_system_font_and_keeps_tabular_figures() {
        let css = css();
        assert!(css.contains("body { font-family: "));
        assert!(css.contains("system-ui, sans-serif !important"));
        assert!(css.contains("font-feature-settings: normal"));
        assert!(
            !css.contains("font-variant-numeric"),
            "tabular figures stay the site's"
        );
        assert!(
            css.contains(":not(.tm-sso, .tm-sso *)"),
            "the sign-in buttons keep their lettering"
        );
    }
}
