//! Keeps the app on the event site. Links to anywhere else open in the
//! system browser, and so does Google sign-in, which refuses embedded
//! webviews (see `sign_in.rs`); on Android it opens in a Custom Tab. A navigation stopped while a page is still
//! loading takes the webview back to the last page that loaded, so it is
//! never left blank.

use std::{collections::HashMap, sync::Mutex};

use tauri::{
    AppHandle, Manager, Runtime, Url, Webview, WebviewUrl, WebviewWindowBuilder,
    plugin::{Builder, TauriPlugin},
    webview::{PageLoadEvent, PageLoadPayload},
};
use tauri_plugin_opener::OpenerExt;

use crate::{last_page, sign_in};

pub const MAIN_WINDOW: &str = "main";

// A test build for the Botan preview: the site is there, on its own port.
pub const SITE_HOST: &str = "botan.tail843dce.ts.net";
pub const SITE_PORT: Option<u16> = Some(4549);

/// Hosts the app loads itself: the site, Clerk's sign-in, and the bot checks
/// the site and Discord show in frames (macOS asks about frames too).
const IN_APP_HOSTS: &[&str] = &[
    SITE_HOST,
    "clerk.ciphermaniac.com",
    "challenges.cloudflare.com",
    "hcaptcha.com",
];
const IN_APP_HOST_SUFFIXES: &[&str] = &[".protect.clerk.com", ".hcaptcha.com"];
const LOCAL_HOSTS: &[&str] = &["localhost", "127.0.0.1"];
/// Whether a local server may stand in for the site, over plain HTTP too: in
/// a debug build only.
pub const LOCAL_SITE: bool = cfg!(debug_assertions);
/// Discord sign-in works in a webview, so its OAuth pages stay in the app
/// and the session lands in the app's cookies.
const DISCORD_SIGN_IN_PATHS: &[&str] = &["/oauth2/", "/login"];

fn is_web(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

fn is_hand_off(url: &Url) -> bool {
    matches!(url.scheme(), "mailto" | "tel" | "sms")
}

fn is_local_host(host: &str) -> bool {
    LOCAL_HOSTS.contains(&host) || host.ends_with(".localhost")
}

fn is_in_app_host(host: &str) -> bool {
    IN_APP_HOSTS.contains(&host)
        || IN_APP_HOST_SUFFIXES
            .iter()
            .any(|suffix| host.ends_with(suffix))
}

/// Whether `url` is on the site itself: over HTTPS on its own port, or with
/// `local` (a debug build) a local server standing in for it.
pub fn is_site_at(url: &Url, local: bool) -> bool {
    let live =
        url.scheme() == "https" && url.host_str() == Some(SITE_HOST) && url.port() == SITE_PORT;
    live || (local
        && url
            .host_str()
            .is_some_and(|host| LOCAL_HOSTS.contains(&host)))
}

/// Whether `url` is on the site, as this build allows (see [`is_site_at`]).
pub fn is_site(url: &Url) -> bool {
    is_site_at(url, LOCAL_SITE)
}

fn is_discord_sign_in(host: &str, path: &str) -> bool {
    host == "discord.com" && DISCORD_SIGN_IN_PATHS.iter().any(|p| path.starts_with(p))
}

/// Whether a navigation loads in the app rather than the system browser.
/// Schemes the webview handles itself (about:, data:, blob:, the app's own
/// protocols) stay; mail and phone links go to the system.
fn stays_in_app(url: &Url) -> bool {
    stays_at(url, LOCAL_SITE)
}

/// [`stays_in_app`], where `local` lets local servers and plain HTTP stay.
fn stays_at(url: &Url, local: bool) -> bool {
    if !is_web(url) {
        return !is_hand_off(url);
    }
    let Some(host) = url.host_str() else {
        return true;
    };
    if local && is_local_host(host) {
        return true;
    }
    (local || url.scheme() == "https")
        && (is_in_app_host(host) || is_discord_sign_in(host, url.path()))
}

/// Opens `url` in the system browser, from a thread of its own: Android
/// answers on its UI thread, which is the one reporting navigations.
pub fn open_outside<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    let app = app.clone();
    let url = url.clone();
    std::thread::spawn(move || {
        if let Err(err) = app.opener().open_url(url.as_str(), None::<&str>) {
            log::warn!("could not open {url} in the system browser: {err}");
        }
    });
}

/// Opens a sign-in that has to leave the webview: in a Custom Tab over the
/// app on Android, which closes back into the app, else in the system browser.
pub fn open_sign_in<R: Runtime>(webview: &Webview<R>, url: &Url) {
    #[cfg(target_os = "android")]
    crate::android::open_sign_in(webview, url);
    #[cfg(not(target_os = "android"))]
    open_outside(webview.app_handle(), url);
}

/// The site's address the main window opens on.
pub fn home_url<R: Runtime>(app: &AppHandle<R>) -> Option<Url> {
    let window = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)?;
    match &window.url {
        WebviewUrl::External(url) => Some(url.clone()),
        _ => None,
    }
}

/// A webview's page load: whether one is under way, and the last that finished.
#[derive(Default)]
struct Load {
    loading: bool,
    last_good: Option<Url>,
}

/// Each webview's page load, by label.
#[derive(Default)]
struct Loads(Mutex<HashMap<String, Load>>);

fn record_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    let loads = webview.state::<Loads>();
    let Ok(mut loads) = loads.0.lock() else {
        return;
    };
    let load = loads.entry(webview.label().to_owned()).or_default();
    load.loading = payload.event() == PageLoadEvent::Started;
    if !load.loading {
        load.last_good = Some(payload.url().clone());
    }
    drop(loads);
    // Started comes as the page commits, at the address it ends up on.
    #[cfg(target_os = "macos")]
    if payload.event() == PageLoadEvent::Started && webview.label() == MAIN_WINDOW {
        crate::mac_title_strip::page_committed(&webview.window(), payload.url());
    }
    #[cfg(target_os = "android")]
    if webview.label() == MAIN_WINDOW {
        crate::android::page_load(webview, payload.event());
    }
    #[cfg(desktop)]
    if payload.event() == PageLoadEvent::Finished {
        crate::appearance::on_page_loaded(webview, payload.url());
    }
    if payload.event() == PageLoadEvent::Finished && webview.label() == MAIN_WINDOW {
        last_page::remember(webview.app_handle(), payload.url());
        #[cfg(desktop)]
        if shows_once_loaded(payload.url(), cfg!(target_os = "macos")) {
            show_main_window(webview.app_handle());
        }
    }
}

/// Whether the main window shows once its first page has loaded. On the Mac
/// a page of the site says when it has drawn real content (`mac_page.rs`),
/// and a blank page shows nothing, so neither does; any other page shows.
#[cfg(any(desktop, test))]
fn shows_once_loaded(url: &Url, waits_for_content: bool) -> bool {
    !waits_for_content || (url.scheme() != "about" && !is_site_at(url, false))
}

/// Whether the main window has been shown since launch.
#[cfg(desktop)]
static SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Shows the main window, which stays hidden until its first page has
/// something to show rather than flash an empty white window. Only the
/// first time: a window closed to the Dock on the Mac (`mac_dock.rs`) stays
/// hidden through the page loads after.
#[cfg(desktop)]
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if SHOWN.swap(true, std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    // On the Mac the window is on screen already, unseen (`mac_page.rs`).
    #[cfg(target_os = "macos")]
    crate::mac_page::reveal(&window);
    #[cfg(not(target_os = "macos"))]
    if let Err(err) = window.show() {
        log::warn!("could not show the window: {err}");
    }
}

/// Brings the main window back and forward when it is hidden or minimized.
#[cfg(desktop)]
pub fn reveal_main_window<R: Runtime>(app: &AppHandle<R>) {
    // Asked for before its page has drawn: it shows as it is.
    show_main_window(app);
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let shown = window
        .show()
        .and_then(|()| window.unminimize())
        .and_then(|()| window.set_focus());
    if let Err(err) = shown {
        log::warn!("could not bring the window back: {err}");
    }
}

/// How long the main window waits for its first page before showing anyway:
/// longer on the Mac, where it waits for the page's content, not its load.
#[cfg(desktop)]
const SHOW_WITHIN: std::time::Duration =
    std::time::Duration::from_secs(if cfg!(target_os = "macos") { 5 } else { 3 });

/// Where a webview goes after a navigation was stopped: nowhere when no page
/// was loading, else back to the last page that loaded, or home.
fn recovery(load: Option<&Load>, home: Option<Url>) -> Option<Url> {
    let load = load.filter(|load| load.loading)?;
    load.last_good.clone().or(home)
}

/// Takes a webview whose loading page was stopped somewhere it can show.
fn recover<R: Runtime>(webview: &Webview<R>) {
    let app = webview.app_handle().clone();
    let target = {
        let loads = webview.state::<Loads>();
        let Ok(loads) = loads.0.lock() else {
            return;
        };
        recovery(loads.get(webview.label()), home_url(&app))
    };
    let Some(target) = target else {
        return;
    };
    let label = webview.label().to_owned();
    let handle = app.clone();
    let navigated = app.run_on_main_thread(move || {
        if let Some(webview) = handle.get_webview_window(&label)
            && let Err(err) = webview.navigate(target)
        {
            log::warn!("could not go back after a stopped page: {err}");
        }
    });
    if let Err(err) = navigated {
        log::warn!("could not go back after a stopped page: {err}");
    }
}

/// Whether a navigation goes ahead in the webview; one that does not is
/// opened outside instead.
fn follow<R: Runtime>(webview: &Webview<R>, url: &Url) -> bool {
    let app = webview.app_handle();
    match sign_in::open_in_browser(webview, url) {
        // The page's own binding fetch would die with a recovery navigation.
        sign_in::Login::Binding => return false,
        sign_in::Login::Opened => {
            recover(webview);
            return false;
        }
        sign_in::Login::NotOne => {}
    }
    if stays_in_app(url) {
        return true;
    }
    open_outside(app, url);
    recover(webview);
    false
}

/// Applies the link policy to every navigation in every webview.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("links")
        .setup(|app, _api| {
            app.manage(Loads::default());
            Ok(())
        })
        .on_page_load(record_load)
        .on_navigation(follow)
        .build()
}

/// Tells the site, before any of its scripts run, that this window can reach
/// TOM (the `tom_*` commands exist only on desktop). Read by `hasTom` in the
/// site's src/lib/native/detect.ts. 3: TOM is a setting of this computer's
/// that the app keeps open and follows itself (`tom.rs`); a build that set 2
/// had the site launch and send through a panel, and one that set `true`
/// checks nothing, so the site leaves both the file workflow.
#[cfg(desktop)]
const TOM_FLAG_SCRIPT: &str = "window.__CM_TOM__ = 3;";

/// Builds the main window from its tauri.conf.json entry (`create: false`)
/// so it can also catch `target="_blank"` links and `window.open` on desktop,
/// and on a phone run the app's stylesheet (`app_style.rs`).
pub fn create_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
    else {
        return Ok(());
    };
    let mut config = config.clone();
    if let Some(page) = last_page::restore(app) {
        config.url = WebviewUrl::External(page);
    }
    let builder = WebviewWindowBuilder::from_config(app, &config)?;
    #[cfg(desktop)]
    let builder = desktop_window(app, builder);
    #[cfg(mobile)]
    let builder = builder
        .initialization_script(crate::app_style::script())
        .initialization_script(crate::appearance::script(
            crate::appearance::Appearance::System,
        ));
    let window = builder.build()?;
    #[cfg(desktop)]
    desktop_window_built(&window);
    #[cfg(mobile)]
    drop(window);
    Ok(())
}

/// What the desktop window needs once it exists: the appearance chosen, and
/// the page color for it behind the page (`appearance.rs`), on the Mac
/// hiding to the Dock when closed (`mac_dock.rs`), Windows'
/// webview hooks (`webview2.rs`) and title bar (`title_bar.rs`), the app's
/// offline page on Linux (`offline.rs`; Windows' is among its webview
/// hooks), and showing it anyway if its first page is slow.
#[cfg(desktop)]
fn desktop_window_built<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    crate::appearance::setup(window);
    #[cfg(target_os = "macos")]
    crate::mac_page::show_unseen(window);
    #[cfg(target_os = "macos")]
    {
        crate::mac_dock::hide_on_close(window);
        crate::mac_page::swipe_back_and_forward(window);
    }
    #[cfg(windows)]
    {
        crate::webview2::setup(window);
        crate::title_bar::keep_through_theme_changes(window);
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    crate::offline::setup(window);
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_WITHIN);
        show_main_window(&app);
    });
}

/// The main window as a desktop app's: hidden until it has something to
/// show, told it can reach TOM, styled as an app (`app_style`), in the
/// appearance chosen (`appearance.rs`) and colored with the site's mode
/// (`theme.rs`), new windows kept in it, on the Mac a title strip in place
/// of the head bar (`mac_title_strip.rs`) with dialogs dropping from it as
/// sheets (`mac_sheets.rs`) and its round picker drawn as one of its group
/// (`mac_controls.rs`), and no Safari link previews on a firm click,
/// and overlay scrollbars and the page's title on Windows.
#[cfg(desktop)]
fn desktop_window<'a, R: Runtime>(
    app: &AppHandle<R>,
    builder: WebviewWindowBuilder<'a, R, AppHandle<R>>,
) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    let follower = app.clone();
    let builder = builder
        .visible(false)
        .initialization_script(TOM_FLAG_SCRIPT)
        .initialization_script(crate::app_style::script())
        .initialization_script(crate::theme::script())
        .initialization_script(crate::appearance::page_script(app))
        .initialization_script(crate::big_screen::script())
        .on_new_window(move |url, _features| {
            follow_new_window(&follower, &url);
            tauri::webview::NewWindowResponse::Deny
        });
    #[cfg(target_os = "macos")]
    let builder = crate::mac_title_strip::window(builder)
        .initialization_script(crate::mac_title_strip::script())
        .initialization_script(crate::mac_page::script())
        .initialization_script(crate::app_style::site_script(crate::mac_sheets::CSS, ""))
        .initialization_script(crate::app_style::site_script(
            &crate::mac_controls::css(),
            "",
        ))
        .allow_link_preview(false);
    // Windows 11's thin scrollbars that widen on hover (WebView2 125 and
    // later), and the page's title on the window, as a Windows app names
    // what it has open.
    #[cfg(windows)]
    let builder = builder
        .scroll_bar_style(tauri::webview::ScrollBarStyle::FluentOverlay)
        .on_document_title_changed(|window, title| {
            let app_name = window.app_handle().config().product_name.clone();
            let title = window_title(&title, app_name.as_deref().unwrap_or_default());
            if let Err(err) = window.set_title(title) {
                log::debug!("could not title the window: {err}");
            }
        });
    builder
}

/// The window's title for a page's: the page's own ("History — Ciphermaniac
/// Events"), or the app's name for a page without one, which the webview
/// reports as its address.
#[cfg(any(windows, test))]
fn window_title<'a>(page_title: &'a str, app_name: &'a str) -> &'a str {
    let page_title = page_title.trim();
    let is_address = Url::parse(page_title)
        .is_ok_and(|url| is_web(&url) || matches!(url.scheme(), "about" | "data" | "blob"));
    if page_title.is_empty() || is_address {
        app_name
    } else {
        page_title
    }
}

/// A new-window request: the big screen opens in its own window, the rest
/// of the site loads in the main window, and anything else leaves the app.
#[cfg(desktop)]
fn follow_new_window<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if !stays_in_app(url) {
        open_outside(app, url);
        return;
    }
    let opened = if crate::big_screen::is_big_screen(url) {
        crate::big_screen::open_later(app, url);
        Ok(())
    } else if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.navigate(url.clone())
    } else {
        Ok(())
    };
    if let Err(err) = opened {
        log::warn!("could not open {url}: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::{Load, is_site_at, recovery, stays_at, stays_in_app, window_title};
    use tauri::Url;

    fn stays(url: &str) -> bool {
        stays_in_app(&Url::parse(url).unwrap())
    }

    #[test]
    fn keeps_the_site_and_sign_in_in_the_app() {
        assert!(stays("https://events.ciphermaniac.com/host"));
        assert!(stays("https://clerk.ciphermaniac.com/v1/oauth_callback"));
        assert!(stays("https://discord.com/oauth2/authorize?client_id=1"));
        assert!(stays("https://discord.com/login?redirect_to=%2Foauth2"));
        assert!(stays("https://challenges.cloudflare.com/cdn-cgi/challenge"));
        assert!(stays("tauri://localhost/"));
        assert!(stays("about:blank"));
    }

    #[test]
    fn sends_everything_else_to_the_system() {
        assert!(!stays("https://accounts.google.com/o/oauth2/v2/auth"));
        assert!(!stays("https://discord.com/invite/abc"));
        assert!(!stays("https://ciphermaniac.com/"));
        assert!(!stays("https://limitlesstcg.com/"));
        assert!(!stays("https://events.ciphermaniac.com.evil.example/"));
        assert!(!stays("mailto:someone@example.com"));
    }

    #[test]
    fn a_release_build_keeps_only_https_and_its_own_pages() {
        let release = |url: &str| stays_at(&Url::parse(url).unwrap(), false);
        assert!(release("https://events.ciphermaniac.com/host"));
        assert!(!release("http://tauri.localhost/index.html"));
        assert!(!release("http://events.ciphermaniac.com/host"));
        assert!(!release("http://localhost:4321/"));
        assert!(!release("http://127.0.0.1:8788/"));
        assert!(!release("http://other.localhost/"));
        let debug = |url: &str| stays_at(&Url::parse(url).unwrap(), true);
        assert!(debug("http://localhost:4321/"));
        assert!(debug("http://other.localhost/"));
    }

    #[test]
    fn a_release_build_takes_only_the_live_https_site_as_the_site() {
        let release = |url: &str| is_site_at(&Url::parse(url).unwrap(), false);
        assert!(release("https://events.ciphermaniac.com/settings"));
        assert!(release("https://events.ciphermaniac.com:443/"));
        assert!(!release("http://events.ciphermaniac.com/"));
        assert!(!release("https://events.ciphermaniac.com:8443/"));
        assert!(!release("http://127.0.0.1:8788/"));
        assert!(!release("http://localhost/"));
        let debug = |url: &str| is_site_at(&Url::parse(url).unwrap(), true);
        assert!(debug("http://localhost:4321/"));
        assert!(!debug("https://example.com/"));
    }

    #[test]
    fn a_page_stopped_while_loading_goes_back_to_the_last_one_that_loaded() {
        let home = Url::parse("https://events.ciphermaniac.com/").ok();
        let last = Url::parse("https://events.ciphermaniac.com/host").ok();
        let loading = |last_good: Option<Url>| Load {
            loading: true,
            last_good,
        };
        assert_eq!(recovery(Some(&loading(last.clone())), home.clone()), last);
        assert_eq!(recovery(Some(&loading(None)), home.clone()), home);
        assert_eq!(recovery(None, home.clone()), None, "nothing loading yet");
        let loaded = Load {
            loading: false,
            last_good: last,
        };
        assert_eq!(recovery(Some(&loaded), home), None, "a loaded page stays");
    }

    #[test]
    fn titles_the_window_with_the_page_or_the_app() {
        let app = "Ciphermaniac Events";
        assert_eq!(
            window_title("History — Ciphermaniac Events", app),
            "History — Ciphermaniac Events"
        );
        assert_eq!(window_title("Pairings: Round 3", app), "Pairings: Round 3");
        assert_eq!(window_title(" ", app), app);
        assert_eq!(window_title("about:blank", app), app);
        assert_eq!(window_title("https://events.ciphermaniac.com/", app), app);
    }

    /// A build pointed at another site changes it everywhere at once, or a
    /// capability (the Mac's title strip, say) is left denied there.
    #[test]
    fn the_window_and_every_capability_name_the_one_site() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = config["app"]["windows"][0]["url"].as_str().unwrap();
        assert_eq!(
            Url::parse(window).unwrap().host_str(),
            Some(super::SITE_HOST)
        );
        for capability in [
            include_str!("../capabilities/site.json"),
            include_str!("../capabilities/mac-title-strip.json"),
        ] {
            let capability: serde_json::Value = serde_json::from_str(capability).unwrap();
            assert_eq!(
                capability["remote"]["urls"],
                serde_json::json!([format!("{window}/*")])
            );
        }
    }

    #[test]
    fn waits_on_the_mac_for_a_site_page_to_draw_but_not_for_other_pages() {
        let url = |url: &str| Url::parse(url).unwrap();
        let site = url("https://events.ciphermaniac.com/host/ABCD");
        assert!(
            !super::shows_once_loaded(&site, true),
            "the page says when it has drawn"
        );
        assert!(!super::shows_once_loaded(&url("about:blank"), true));
        assert!(super::shows_once_loaded(
            &url("https://discord.com/oauth2/authorize"),
            true
        ));
        assert!(super::shows_once_loaded(&site, false), "elsewhere, at load");
    }
}
