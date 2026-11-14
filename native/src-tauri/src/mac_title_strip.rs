//! On the Mac, no head bar: the window's title bar is a 38 pt strip in the
//! head bar's near-black, with the window's buttons on its center line and
//! the account (or Sign in) at its right. The site's head bar becomes that
//! strip: the window draws no title bar of its own (an overlay one, its
//! title hidden, so Mission Control and the Window menu still name it), the
//! site's name leaves the bar, and the bar takes the strip's height, so the
//! rows that stick under it follow. The page starts closer under it than
//! under the head bar, whose name and account gave the space above a page
//! its weight.
//!
//! The strip moves the window when dragged, and a double click does what
//! the system's "Double-click a window's title bar" setting says, as a
//! title bar does; its controls stay theirs. While a dialog is open over
//! the page, its backdrop's top still moves the window.

/// The strip's height, in points.
const HEIGHT: u32 = 38;

/// The space between the strip and the page's first line, in place of the
/// site's 36 px.
const PAGE_GAP: u32 = 18;

/// A window button's size.
const BUTTON: u32 = 16;

/// Where `AppKit` puts the close button from the inset asked for: measured
/// on macOS 15, an inset of (12, 9) put it 11 pt from the left and 3 pt
/// from the top.
#[cfg(any(target_os = "macos", test))]
const BUTTON_SHIFT: u32 = 1;
#[cfg(any(target_os = "macos", test))]
const BUTTON_RISE: u32 = 6;

/// The space above and below a window button on the strip's center line.
const fn button_margin() -> u32 {
    (HEIGHT - BUTTON) / 2
}

/// How far the close button sits from the window's left edge: a little more
/// than above it, as `AppKit` places it in its own toolbars (20 pt in a 52 pt
/// one, 18 above). The account sits as far from the right edge.
const fn edge() -> u32 {
    button_margin() + 2
}

/// The room the window's buttons take at the left: three buttons 20 pt
/// apart, and after them a gap a little wider than the space above them.
const fn lights_room() -> u32 {
    edge() + 2 * 20 + BUTTON + button_margin() + 6
}

/// The inset that puts the close button there.
#[cfg(any(target_os = "macos", test))]
fn traffic_lights() -> (f64, f64) {
    (
        f64::from(edge() + BUTTON_SHIFT),
        f64::from(button_margin() + BUTTON_RISE),
    )
}

/// The window with no title bar of its own and its buttons on the strip.
#[cfg(target_os = "macos")]
pub fn window<R: tauri::Runtime>(
    builder: tauri::WebviewWindowBuilder<'_, R, tauri::AppHandle<R>>,
) -> tauri::WebviewWindowBuilder<'_, R, tauri::AppHandle<R>> {
    let (x, y) = traffic_lights();
    builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(x, y))
}

/// The head bar as the strip. Its controls are 24 px, 7 above and below,
/// on the window buttons' center line and as far from the right edge as
/// the close button is from the left. The account button takes a faint
/// ring under the pointer and dims while held (`press.rs`), and its menu
/// stays inside the window. `:root` outweighs the site's own rules for the bar, including a phone
/// width's gutters and stylesheets a page loads later.
fn css() -> String {
    format!(
        ":root, body[data-mode] {{ --topnav-h: {HEIGHT}px !important; }} \
         :root .site-head-name {{ display: none; }} \
         :root .site-head-row {{ max-width: none; justify-content: flex-end; \
         padding: 0 {right}px 0 {left}px; }} \
         :root .site-head .tm-acct-button {{ width: 24px; height: 24px; font-size: 11px; }} \
         :root .site-head-signin {{ min-height: 24px; height: 24px; font-size: 12px; }} \
         :root .site-head .tm-acct-button:hover {{ \
         box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg) 22%, transparent); }} \
         :root .site-head .tm-acct-menu {{ max-height: calc(100dvh - var(--topnav-h) - {right}px - 8px); }} \
         :root main.page {{ padding-top: {PAGE_GAP}px; }}",
        right = edge(),
        left = lights_room(),
    )
}

/// What a press on the strip may not take: the controls in it.
const CONTROLS: &str = "a, button, input, select, textarea, label, summary, [role], \
                        [tabindex]:not([tabindex=\"-1\"]), [contenteditable]:not([contenteditable=\"false\"])";

/// Drags the window from the strip, and acts on a double click when the
/// button comes up where it went down, as `AppKit` does.
fn drag_script() -> String {
    format!(
        "const onStrip = event => {{ const target = event.target; \
         if (!(target instanceof Element)) return false; const head = target.closest('.site-head'); \
         if (head) {{ const control = target.closest('{CONTROLS}'); return !control || !head.contains(control); }} \
         return target.tagName === 'DIALOG' && event.clientY < {HEIGHT}; }}; \
         const invoke = command => window.__TAURI_INTERNALS__.invoke(command).catch(() => {{}}); \
         let pressed = null; \
         document.addEventListener('mousedown', event => {{ \
         if (event.button !== 0 || !onStrip(event)) return; \
         if (event.detail === 2) {{ pressed = [event.clientX, event.clientY]; return; }} \
         if (event.detail !== 1) return; event.preventDefault(); invoke('plugin:window|start_dragging'); }}); \
         document.addEventListener('mouseup', event => {{ const at = pressed; pressed = null; \
         if (event.button !== 0 || event.detail !== 2 || !at || !onStrip(event)) return; \
         if (at[0] === event.clientX && at[1] === event.clientY) invoke('title_strip_double_click'); }});"
    )
}

/// The script each page of the main window runs first.
#[cfg(target_os = "macos")]
pub fn script() -> String {
    crate::app_style::site_script(&css(), &drag_script())
}

/// What the system's setting has a double click on a title bar do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DoubleClick {
    Zoom,
    Minimize,
    Nothing,
}

/// The action for `AppleActionOnDoubleClick` ("Maximize", that is Zoom, by
/// default; "Fill" in macOS 15, which zooming comes closest to), or for the
/// older `AppleMiniaturizeOnDoubleClick` when it is unset.
#[cfg(any(target_os = "macos", test))]
fn double_click(action: Option<&str>, minimize: bool) -> DoubleClick {
    match (action, minimize) {
        (Some("Minimize"), _) | (None, true) => DoubleClick::Minimize,
        (Some("None"), _) => DoubleClick::Nothing,
        _ => DoubleClick::Zoom,
    }
}

#[cfg(target_os = "macos")]
fn system_double_click() -> DoubleClick {
    use objc2_foundation::{NSUserDefaults, ns_string};
    let defaults = NSUserDefaults::standardUserDefaults();
    let action = defaults
        .stringForKey(ns_string!("AppleActionOnDoubleClick"))
        .map(|action| action.to_string());
    let minimize = defaults.boolForKey(ns_string!("AppleMiniaturizeOnDoubleClick"));
    double_click(action.as_deref(), minimize)
}

/// A double click on the strip.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn title_strip_double_click<R: tauri::Runtime>(window: tauri::WebviewWindow<R>) {
    let done = match system_double_click() {
        DoubleClick::Zoom if window.is_maximized().unwrap_or(false) => window.unmaximize(),
        DoubleClick::Zoom => window.maximize(),
        DoubleClick::Minimize => window.minimize(),
        DoubleClick::Nothing => Ok(()),
    };
    if let Err(err) = done {
        log::debug!("could not act on the title strip's double click: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::{DoubleClick, css, double_click, drag_script, lights_room, traffic_lights};

    #[test]
    fn centers_the_windows_buttons_on_the_strip() {
        // 11 pt above and below the 16 pt buttons, the close button 13 pt
        // from the left; the inset is 1 pt right of that and 6 pt lower.
        assert_eq!(traffic_lights(), (14.0, 17.0));
        assert_eq!(lights_room(), 13 + 40 + 16 + 11 + 6);
    }

    #[test]
    fn makes_the_head_bar_the_strip() {
        let css = css();
        assert!(css.contains("--topnav-h: 38px !important"));
        assert!(css.contains(":root .site-head-name { display: none; }"));
        assert!(css.contains("padding: 0 13px 0 86px"));
        assert!(css.contains(":root main.page { padding-top: 18px; }"));
        assert!(css.contains(".tm-acct-button:hover"));
        assert!(css.contains("max-height: calc(100dvh - var(--topnav-h) - 13px - 8px)"));
    }

    #[test]
    fn drags_from_the_strip_but_not_its_controls() {
        let script = drag_script();
        assert!(script.contains("closest('.site-head')"));
        assert!(script.contains("plugin:window|start_dragging"));
        assert!(script.contains("invoke('title_strip_double_click')"));
        assert!(script.contains("event.clientY < 38"));
    }

    #[test]
    fn double_clicks_as_the_system_setting_says() {
        assert_eq!(double_click(None, false), DoubleClick::Zoom);
        assert_eq!(double_click(None, true), DoubleClick::Minimize);
        assert_eq!(double_click(Some("Maximize"), false), DoubleClick::Zoom);
        assert_eq!(double_click(Some("Fill"), false), DoubleClick::Zoom);
        assert_eq!(double_click(Some("Minimize"), false), DoubleClick::Minimize);
        assert_eq!(double_click(Some("None"), true), DoubleClick::Nothing);
    }
}
