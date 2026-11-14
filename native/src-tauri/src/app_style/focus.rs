//! Focus rings for the keyboard only. The webview shows the site's ring on
//! a link or button focused after a click, and on the first button of a
//! dialog that opens, as `:focus-visible` allows; a native app shows one
//! only once the keyboard is in use. The root carries `data-app-keyboard`
//! from a key press (a menu shortcut aside) until the next press of a
//! pointer, and without it a link or button draws no ring. Fields keep
//! theirs, which show where typing goes.

pub const CSS: &str = "\
:root:not([data-app-keyboard]) :focus-visible:not(input):not(textarea):not(select) { outline: none !important; }";

/// Tracks whether the keyboard or a pointer was used last. It runs before
/// the page has a root, so it marks the root only once there is one.
pub const SCRIPT: &str = "\
const markKeyboard = on => document.documentElement?.toggleAttribute('data-app-keyboard', on); \
document.addEventListener('keydown', event => { \
if (!event.metaKey && !event.ctrlKey && !event.altKey) markKeyboard(true); }, true); \
document.addEventListener('pointerdown', () => markKeyboard(false), true);";

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
    }
}
