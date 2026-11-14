//! Keeps the app on the event site. Links to anywhere else open in the
//! system browser, including Google sign-in, which refuses embedded webviews.
//! A navigation stopped while a page is still loading takes the webview back
//! to the last page that loaded, so it is never left blank.

use std::{collections::HashMap, sync::Mutex};

use tauri::{
    AppHandle, Manager, Runtime, Url, Webview, WebviewUrl, WebviewWindowBuilder,
    plugin::{Builder, TauriPlugin},
    webview::{PageLoadEvent, PageLoadPayload},
};
use tauri_plugin_opener::OpenerExt;

const MAIN_WINDOW: &str = "main";

const SITE_HOST: &str = "events.ciphermaniac.com";

/// Hosts the app loads itself: the site, Clerk's sign-in, and the bot checks
/// the site and Discord show in frames (macOS asks about frames too).
const IN_APP_HOSTS: &[&str] = &[
    SITE_HOST,
    "clerk.ciphermaniac.com",
    "challenges.cloudflare.com",
    "hcaptcha.com",
];
const IN_APP_HOST_SUFFIXES: &[&str] = &[".protect.clerk.com", ".hcaptcha.com", ".localhost"];
const LOCAL_HOSTS: &[&str] = &["localhost", "127.0.0.1"];
/// Discord sign-in works in a webview, so its OAuth pages stay in the app
/// and the session lands in the app's cookies.
const DISCORD_SIGN_IN_PATHS: &[&str] = &["/oauth2/", "/login"];

fn is_web(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

fn is_hand_off(url: &Url) -> bool {
    matches!(url.scheme(), "mailto" | "tel" | "sms")
}

fn is_in_app_host(host: &str) -> bool {
    IN_APP_HOSTS.contains(&host)
        || LOCAL_HOSTS.contains(&host)
        || IN_APP_HOST_SUFFIXES
            .iter()
            .any(|suffix| host.ends_with(suffix))
}

fn is_discord_sign_in(host: &str, path: &str) -> bool {
    host == "discord.com" && DISCORD_SIGN_IN_PATHS.iter().any(|p| path.starts_with(p))
}

/// Whether a navigation loads in the app rather than the system browser.
/// Schemes the webview handles itself (about:, data:, blob:, the app's own
/// protocols) stay; mail and phone links go to the system.
fn stays_in_app(url: &Url) -> bool {
    if !is_web(url) {
        return !is_hand_off(url);
    }
    url.host_str()
        .is_none_or(|host| is_in_app_host(host) || is_discord_sign_in(host, url.path()))
}

fn open_outside<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if let Err(err) = app.opener().open_url(url.as_str(), None::<&str>) {
        log::warn!("could not open {url} in the system browser: {err}");
    }
}

/// The site's address the main window opens on.
fn home_url<R: Runtime>(app: &AppHandle<R>) -> Option<Url> {
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
}

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
/// site's src/lib/native/detect.ts.
#[cfg(desktop)]
const TOM_FLAG_SCRIPT: &str = "window.__CM_TOM__ = true;";

/// Builds the main window from its tauri.conf.json entry (`create: false`)
/// so it can also catch `target="_blank"` links and `window.open` on desktop.
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
    let builder = WebviewWindowBuilder::from_config(app, config)?;
    #[cfg(desktop)]
    let builder = {
        let app = app.clone();
        builder
            .initialization_script(TOM_FLAG_SCRIPT)
            .on_new_window(move |url, _features| {
                follow_new_window(&app, &url);
                tauri::webview::NewWindowResponse::Deny
            })
    };
    builder.build()?;
    Ok(())
}

/// A new-window request either loads in the main window or leaves the app.
#[cfg(desktop)]
fn follow_new_window<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if !stays_in_app(url) {
        open_outside(app, url);
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW)
        && let Err(err) = window.navigate(url.clone())
    {
        log::warn!("could not open {url}: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::{Load, recovery, stays_in_app};
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
        assert!(stays("http://tauri.localhost/index.html"));
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
}
