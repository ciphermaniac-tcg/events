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
//!
//! The window's buttons never sit on the page. The window draws over the
//! page only while a page of the site is in it (`page_committed`, as each
//! page commits), and the strip's style goes into that page before it
//! first paints. Any other page, the app's own among them, has a title bar
//! of its own above it. The site's head under the style is checked by the
//! site's tests (tests/e2e), not by looking at the page here.

/// The strip's height, in points.
const HEIGHT: u32 = 38;

/// The space between the strip and the page's first line, in place of the
/// site's 36 px.
#[cfg(test)]
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
#[cfg(test)]
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

/// The window, its buttons placed for the strip but above the page until the
/// site's first page commits. Placed so, they end above a title bar's 28 pt
/// as well.
#[cfg(target_os = "macos")]
pub fn window<R: tauri::Runtime>(
    builder: tauri::WebviewWindowBuilder<'_, R, tauri::AppHandle<R>>,
) -> tauri::WebviewWindowBuilder<'_, R, tauri::AppHandle<R>> {
    let (x, y) = traffic_lights();
    builder
        .title_bar_style(ABOVE)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(x, y))
}

/// A title bar above the page, with the window's buttons in it.
#[cfg(target_os = "macos")]
const ABOVE: tauri::TitleBarStyle = tauri::TitleBarStyle::Transparent;

/// Whether the window draws over the page: once the main window's page
/// commits, only for a page of the live site, whose style makes room for the
/// window's buttons. A page of the site reloading keeps the strip, so the
/// page does not move.
#[cfg(target_os = "macos")]
pub fn page_committed<R: tauri::Runtime>(window: &tauri::Window<R>, url: &tauri::Url) {
    static STRIP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let strip = takes_strip(url);
    if STRIP.swap(strip, std::sync::atomic::Ordering::Relaxed) == strip {
        return;
    }
    let style = if strip {
        tauri::TitleBarStyle::Overlay
    } else {
        ABOVE
    };
    if let Err(err) = window.set_title_bar_style(style) {
        log::debug!("could not change the title bar: {err}");
    }
}

/// The pages the strip's style goes into (`script`): the live site's.
#[cfg(any(target_os = "macos", test))]
fn takes_strip(url: &tauri::Url) -> bool {
    crate::shell::is_site_at(url, false)
}

/// The strip's controls: the account button and Sign in.
#[cfg(test)]
const CONTROL: u32 = 24;

/// The space between the strip and the account menu under it.
#[cfg(test)]
const MENU_GAP: u32 = 6;

/// How far the account menu opens below the account button: the space under
/// the button, the strip's 1 px border, and the gap.
#[cfg(test)]
const fn menu_drop() -> u32 {
    (HEIGHT - CONTROL) / 2 + 1 + MENU_GAP
}

/// The head bar as the strip (`mac_title_strip.css`). Its controls sit on
/// the window buttons' center line, as far from the right edge as the close
/// button is from the left. The account button takes a faint ring under the
/// pointer and dims while held (`press.rs`); its menu opens just under the
/// strip, its right edge on the button's, and scrolls rather than run past
/// the window's bottom. `:root` outweighs the site's own rules for the bar,
/// including a phone width's gutters and stylesheets a page loads later.
const CSS: &str = include_str!("mac_title_strip.css");

/// The script each page of the main window runs first: on the site's pages,
/// the strip's style before the page first paints, as the page's own last
/// stylesheet, then the strip's drag and double click (`mac_title_strip.js`).
#[cfg(any(target_os = "macos", test))]
fn script_for(site: &str) -> String {
    format!(
        "(() => {{ if (location.hostname !== '{site}') return; \
         const sheet = new CSSStyleSheet(); sheet.replaceSync({css}); \
         document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; \
         ({js})({HEIGHT}, command => window.__TAURI_INTERNALS__.invoke(command).catch(() => {{}})); }})();",
        css = serde_json::Value::from(CSS),
        js = include_str!("mac_title_strip.js").trim_end(),
    )
}

#[cfg(target_os = "macos")]
pub fn script() -> String {
    script_for(crate::shell::SITE_HOST)
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
    use super::{
        BUTTON, CONTROL, CSS, DoubleClick, HEIGHT, PAGE_GAP, double_click, edge, lights_room,
        menu_drop, script_for, takes_strip, traffic_lights,
    };

    #[test]
    fn centers_the_windows_buttons_on_the_strip() {
        // 11 pt above and below the 16 pt buttons, the close button 13 pt
        // from the left; the inset is 1 pt right of that and 6 pt lower.
        assert_eq!(traffic_lights(), (14.0, 17.0));
        assert_eq!(lights_room(), 13 + 40 + 16 + 11 + 6);
    }

    #[test]
    fn makes_the_head_bar_the_strip_with_the_strips_measures() {
        let has = |rule: String| assert!(CSS.contains(&rule), "{rule}");
        has(format!("--topnav-h: {HEIGHT}px !important"));
        has(":root .site-head-name { display: none; }".into());
        has(format!("padding: 0 {}px 0 {}px", edge(), lights_room()));
        has(format!("width: {CONTROL}px; height: {CONTROL}px;"));
        has(format!("min-height: {CONTROL}px; height: {CONTROL}px;"));
        has(format!(":root main.page {{ padding-top: {PAGE_GAP}px; }}"));
        has(".tm-acct-button:hover".into());
        has(format!(
            ".tm-acct-menu {{ top: calc(100% + {}px); right: 0;",
            menu_drop()
        ));
        has(format!(
            "max-height: calc(100dvh - var(--topnav-h) - {}px)",
            1 + 6 + edge()
        ));
    }

    #[test]
    fn styles_the_sites_pages_before_they_paint_and_drags_from_the_strip() {
        let script = script_for("events.ciphermaniac.com");
        assert!(
            script.starts_with(
                "(() => { if (location.hostname !== 'events.ciphermaniac.com') return;"
            )
        );
        assert!(
            script
                .contains("document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]")
        );
        assert!(script.contains("padding: 0 13px 0 86px"));
        assert!(script.contains("closest('.site-head')"));
        assert!(script.contains("plugin:window|start_dragging"));
        assert!(script.contains("invoke('title_strip_double_click')"));
        assert!(
            script.contains(&format!("}}))({HEIGHT}, command =>")),
            "the page's side runs"
        );
    }

    #[test]
    fn draws_over_only_the_live_sites_pages() {
        let url = |url: &str| tauri::Url::parse(url).unwrap();
        assert!(takes_strip(&url(
            "https://events.ciphermaniac.com/host/ABCD"
        )));
        assert!(!takes_strip(&url("https://clerk.ciphermaniac.com/sign-in")));
        assert!(!takes_strip(&url("https://discord.com/oauth2/authorize")));
        assert!(!takes_strip(&url("tauri://localhost/index.html")));
        assert!(
            !takes_strip(&url("http://localhost:4321/host")),
            "a local site has no strip style"
        );
        assert!(!takes_strip(&url("about:blank")));
    }

    #[test]
    fn the_buttons_end_above_a_title_bar_too() {
        let (_, y) = traffic_lights();
        assert!(y - f64::from(super::BUTTON_RISE) + f64::from(BUTTON) <= 28.0);
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
