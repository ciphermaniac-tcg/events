//! Material 3's components on Android, in the site's own colours. The
//! console's and dashboard's bar along the bottom of a phone is a Material
//! navigation bar: 80 dp, each icon in a pill that fills on the open tab.
//! Wider than a phone, the console's sections move to a navigation rail at
//! the left, under the head bar, in place of its tabs along the top, with
//! icons alone when the screen is short, as on a phone held sideways; the
//! dashboard keeps its tabs beside its heading. A sheet from the bottom of
//! a phone has Material's 28 dp corners and a drag handle in place of its
//! Close, which stays for screen readers; the drag itself is the Android
//! bridge's (`app_bridge.js`). Dialogs have 28 dp corners, a 24 sp title
//! and their answers as text buttons, the main one in the accent's ink.

/// The navigation bar and the rail.
pub const NAV: &str = "\
:root, body[data-mode] { --tabbar-h: 80px; } \
@media (max-width: 640px) { \
.tm-tabbar :is(button, a) { gap: 4px; padding: 12px 0 16px; font-size: 12px; } \
.tm-tabbar [aria-selected='true'] { color: var(--fg); } \
.tm-tabbar .tm-dash-count { top: 10px; left: calc(50% + 14px); } } \
.tm-tabbar :is(button, a)::before { content: ''; position: absolute; top: 12px; left: 50%; \
width: 64px; height: 32px; margin-left: -32px; border-radius: 16px; } \
.tm-tabbar [aria-selected='true']::before { background: var(--surface-2); } \
.tm-tabbar :is(button, a) > svg { position: relative; width: 24px; height: 24px; margin: 4px 0; } \
@media (min-width: 641px) { \
.tm-console > .tabs { display: none; } \
.tm-console > .tm-tabbar { position: fixed; top: calc(var(--topnav-h) + 1px); bottom: 0; left: 0; z-index: 30; \
display: flex; flex-direction: column; align-items: center; gap: 12px; overflow-y: auto; \
width: calc(80px + env(safe-area-inset-left)); padding: 12px 0 12px env(safe-area-inset-left); \
border-right: 1px solid var(--border); background: var(--surface); } \
.tm-console > .tm-tabbar :is(button, a) { position: relative; display: flex; flex-direction: column; align-items: center; \
gap: 4px; width: 80px; padding: 0 0 4px; border: 0; background: none; color: var(--muted); \
font-family: inherit; font-size: 12px; font-weight: 500; line-height: 16px; text-decoration: none; } \
.tm-console > .tm-tabbar :is(button, a)::before { top: 0; } \
.tm-console > .tm-tabbar [aria-selected='true'] { color: var(--fg); font-weight: 600; } \
body:has(.tm-console > .tm-tabbar) main.page { max-width: min(1180px, calc(100% - 80px)); \
margin-left: max(80px, calc((100% - 1100px) / 2)); } \
@media (max-height: 480px) { .tm-console > .tm-tabbar :is(button, a) > span { position: absolute; \
width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } } }";

/// The bottom sheet. Its head takes the drag, so the page doesn't pan.
pub const SHEETS: &str = "\
@media (max-width: 640px) { \
.tm-sheet { padding-top: 22px; border-top: 0; border-radius: 28px 28px 0 0; } \
.tm-sheet::before { content: ''; position: absolute; top: 10px; left: 50%; width: 32px; height: 4px; \
margin-left: -16px; border-radius: 2px; background: var(--border); } \
.tm-sheet-head { touch-action: none; } \
.tm-sheet-head > .btn { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; \
overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }";

/// The dialog. Its parts share the title's 24 dp inset.
pub const DIALOGS: &str = "\
.tm-modal { width: min(560px, calc(100vw - 48px)); border: 0; border-radius: 28px; } \
.tm-modal > :is(.tm-box-bar, .tm-choice) { padding-inline: 24px; } \
.tm-modal > .tm-box-bar:first-child { padding-block: 24px 16px; border-bottom: 0; } \
.tm-modal h3 { font-size: 24px; line-height: 32px; font-weight: 400; } \
.tm-modal .tm-modal-foot { gap: 8px; padding-block: 16px 24px; border-top: 0; } \
.tm-modal .tm-modal-foot .btn { min-width: 0; height: 40px; padding: 0 12px; border: 0; border-radius: 20px; \
background: none; box-shadow: none; color: var(--accent-ink); font-weight: 600; } \
.tm-modal .tm-modal-foot .tm-danger { color: var(--negative); } \
.tm-modal .tm-modal-foot .btn:disabled { color: var(--muted); }";

/// Every component's rules.
pub fn css() -> String {
    [NAV, SHEETS, DIALOGS].join(" ")
}

#[cfg(test)]
mod tests {
    use super::{DIALOGS, NAV, SHEETS, css};

    #[test]
    fn draws_the_open_tab_in_a_pill_on_an_80_dp_bar() {
        assert!(css().contains(":root, body[data-mode] { --tabbar-h: 80px; }"));
        assert!(NAV.contains("width: 64px; height: 32px;"));
        assert!(NAV.contains(
            ".tm-tabbar [aria-selected='true']::before { background: var(--surface-2); }"
        ));
    }

    #[test]
    fn moves_the_console_sections_to_a_rail_wider_than_a_phone() {
        let (_, wide) = NAV.split_once("@media (min-width: 641px)").unwrap();
        assert!(wide.contains(".tm-console > .tabs { display: none; }"));
        assert!(wide.contains(".tm-console > .tm-tabbar { position: fixed;"));
    }

    #[test]
    fn keeps_every_rail_tab_in_reach_on_a_phone_held_sideways() {
        let (_, wide) = NAV.split_once("@media (min-width: 641px)").unwrap();
        let (_, short) = wide.split_once("@media (max-height: 480px)").unwrap();
        assert!(short.contains(":is(button, a) > span { position: absolute;"));
        assert!(wide.contains("overflow-y: auto;"));
        assert!(wide.contains("body:has(.tm-console > .tm-tabbar) main.page { max-width: min(1180px, calc(100% - 80px));"));
    }

    #[test]
    fn gives_a_phone_sheet_round_corners_and_a_handle_for_its_close() {
        let css = css();
        assert!(css.contains(SHEETS));
        assert!(SHEETS.contains("border-radius: 28px 28px 0 0"));
        assert!(SHEETS.contains(".tm-sheet::before { content: '';"));
        assert!(SHEETS.contains(".tm-sheet-head > .btn { position: absolute; width: 1px;"));
    }

    #[test]
    fn rounds_a_dialog_and_answers_it_with_text_buttons() {
        assert!(css().contains(DIALOGS));
        assert!(DIALOGS.contains(
            ".tm-modal { width: min(560px, calc(100vw - 48px)); border: 0; border-radius: 28px; }"
        ));
        assert!(DIALOGS.contains("background: none; box-shadow: none; color: var(--accent-ink);"));
        assert!(
            DIALOGS.contains(".tm-modal .tm-modal-foot .tm-danger { color: var(--negative); }")
        );
    }
}
