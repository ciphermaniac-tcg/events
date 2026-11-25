//! Focus rings for the keyboard only. The webview shows the site's ring on
//! a link or button focused after a click, and on the first button of a
//! dialog that opens, as `:focus-visible` allows; a native app shows one
//! only once the keyboard is in use. The root carries `data-app-keyboard`
//! from a key press (a menu shortcut aside) until the next press of a
//! pointer, and without it a link or button draws no ring. Fields keep
//! theirs, which show where typing goes. The site's skip link is the
//! keyboard's first stop alone: the webview focusing it as the window
//! takes a page does not show it, and the first Tab still does.

pub const CSS: &str = "\
:root:not([data-app-keyboard]) :focus-visible:not(input):not(textarea):not(select) { outline: none !important; }";

/// Tracks whether the keyboard or a pointer was used last. It runs before
/// the page has a root, so it marks the root only once there is one.
pub const SCRIPT: &str = "\
const markKeyboard = on => document.documentElement?.toggleAttribute('data-app-keyboard', on); \
document.addEventListener('keydown', event => { \
if (!event.metaKey && !event.ctrlKey && !event.altKey) markKeyboard(true); }, true); \
document.addEventListener('pointerdown', () => markKeyboard(false), true); \
document.addEventListener('focusin', event => { \
if (event.target instanceof Element && event.target.matches('.skip-link') \
&& !document.documentElement.hasAttribute('data-app-keyboard')) event.target.blur(); }, true);";

#[cfg(test)]
mod tests {
    use super::{CSS, SCRIPT};

    #[test]
    fn shows_rings_only_once_the_keyboard_is_used() {
        assert!(CSS.contains(":root:not([data-app-keyboard]) :focus-visible"));
        assert!(
            CSS.contains(":not(input):not(textarea):not(select)"),
            "fields keep theirs"
        );
        assert!(SCRIPT.contains("'keydown'") && SCRIPT.contains("'pointerdown'"));
        assert!(SCRIPT.contains("document.documentElement?."));
        assert!(
            SCRIPT.contains("matches('.skip-link')")
                && SCRIPT.contains("!document.documentElement.hasAttribute('data-app-keyboard')) event.target.blur()"),
            "the skip link waits for the keyboard"
        );
    }
}
