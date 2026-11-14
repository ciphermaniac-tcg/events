//! On the Mac, the site's confirmations and editors open as sheets: they
//! drop from just under the title strip (`mac_title_strip.rs`) rather than
//! appearing in the middle of the window, square at the top where they meet
//! it, over a lighter shade. In a window wider than a phone the player
//! sheet drops the same way, centered, rather than sliding in at the side.
//!
//! A sheet is one surface, as a Mac sheet is: no rules between its title,
//! its body and its buttons, 20 px in from its edges, the body close under
//! the title and the buttons 12 px apart. Its default button takes no ring
//! when the sheet opens; with the keyboard in use (`focus.rs`) the focused
//! control takes a soft ring rather than the site's heavy one.
//!
//! `:root` outweighs the site's own rules for them, which a page may load
//! after these.

pub const CSS: &str = "\
@keyframes app-sheet-drop { from { transform: translateY(-14px); opacity: 0; } } \
:root dialog.tm-modal[open] { margin: var(--topnav-h) auto auto; border-top: 0; \
border-radius: 0 0 10px 10px; animation: app-sheet-drop 180ms ease-out; } \
:root dialog.tm-modal::backdrop { background: rgba(0, 0, 0, 0.18); } \
@media (min-width: 641px) { \
:root .tm-scrim { top: var(--topnav-h); background: rgba(0, 0, 0, 0.18); } \
:root .tm-sheet { top: var(--topnav-h); bottom: auto; left: 50%; right: auto; translate: -50% 0; \
width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - var(--topnav-h) - 40px); \
border: 1px solid var(--border); border-top: 0; border-radius: 0 0 10px 10px; \
animation: app-sheet-drop 180ms ease-out; } } \
@media (prefers-reduced-motion: reduce) { :root :is(dialog.tm-modal[open], .tm-sheet) { animation: none; } } \
:root dialog.tm-modal .tm-box-bar { border: 0; padding: 0 20px; } \
:root dialog.tm-modal .tm-box-bar:first-child { padding-top: 20px; } \
:root dialog.tm-modal .tm-box-bar + .tm-box-bar { padding-top: 8px; } \
:root dialog.tm-modal .tm-box-bar.tm-modal-foot { margin-top: 0; padding: 20px; border-top: 0; gap: 12px; } \
:root[data-app-keyboard] dialog.tm-modal :focus-visible:not(input):not(textarea):not(select) \
{ outline: 3px solid color-mix(in srgb, var(--focus-color) 35%, transparent); outline-offset: 1px; }";

#[cfg(test)]
mod tests {
    use super::CSS;

    #[test]
    fn drops_dialogs_from_under_the_title_strip() {
        assert!(CSS.contains("dialog.tm-modal[open] { margin: var(--topnav-h) auto auto;"));
        assert!(CSS.contains(":root .tm-sheet { top: var(--topnav-h);"));
        assert!(CSS.contains("prefers-reduced-motion: reduce"));
    }

    #[test]
    fn makes_a_sheet_one_surface_with_a_soft_keyboard_ring() {
        assert!(CSS.contains(":root dialog.tm-modal .tm-box-bar { border: 0; padding: 0 20px; }"));
        assert!(CSS.contains(".tm-modal-foot { margin-top: 0; padding: 20px; border-top: 0;"));
        assert!(CSS.contains(":root[data-app-keyboard] dialog.tm-modal :focus-visible"));
    }
}
