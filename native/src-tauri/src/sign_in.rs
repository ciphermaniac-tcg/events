//! Sign-in with a provider that refuses the app's webview (Google). The app
//! sends the site's login to the system browser with the SHA-256 of a random
//! verifier it keeps; the browser signs in and hands back a one-time ticket
//! by the app's link (`ciphermaniac-events://auth?ticket=…`); the main window
//! then posts ticket and verifier from a page of the site, which sets the
//! session in the app's own cookies (functions/lib/auth/appTicket.ts on the
//! site). The site takes the post only with its own Origin, so a page of the
//! site has to send it.

use std::{
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use sha2::{Digest, Sha256};
use tauri::{
    AppHandle, Manager, Runtime, Url, Webview,
    plugin::{Builder, TauriPlugin},
    webview::PageLoadEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::{pending, shell};

/// Providers whose sign-in has to leave the webview. Discord's works inside.
const BROWSER_PROVIDERS: &[&str] = &["google"];
const LOGIN_PATH: &str = "/api/auth/login/";
const REDEEM_PATH: &str = "/api/auth/redeem";
const LINK_SCHEME: &str = "ciphermaniac-events";
const LINK_HOST: &str = "auth";
/// Where the verifier waits, inside the app's data directory (`pending.rs`).
const PENDING_DIR: &str = "sign-in";

/// Whether the launch link has been looked at; the app does it once.
static LAUNCH_LINK_SEEN: AtomicBool = AtomicBool::new(false);

/// A ticket waiting for the main window's next page of the site, with the
/// verifier taken out for it.
struct Redeem {
    ticket: String,
    verifier: String,
}

static PENDING: Mutex<Option<Redeem>> = Mutex::new(None);

fn is_browser_login(url: &Url) -> bool {
    url.host_str().is_some_and(shell::is_site_host)
        && url
            .path()
            .strip_prefix(LOGIN_PATH)
            .is_some_and(|provider| BROWSER_PROVIDERS.contains(&provider))
}

/// The login as the system browser opens it: the page's own query plus the
/// app's flag and challenge.
fn browser_login(url: &Url, challenge: &str) -> Option<Url> {
    if !is_browser_login(url) {
        return None;
    }
    let mut login = url.clone();
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| key != "app" && key != "challenge")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    login
        .query_pairs_mut()
        .clear()
        .extend_pairs(kept)
        .append_pair("app", "1")
        .append_pair("challenge", challenge);
    Some(login)
}

/// The ticket an app link hands over, when it is one of the app's.
fn ticket_of(link: &Url) -> Option<String> {
    if link.scheme() != LINK_SCHEME || link.host_str() != Some(LINK_HOST) {
        return None;
    }
    link.query_pairs()
        .find(|(key, _)| key == "ticket")
        .map(|(_, ticket)| ticket.into_owned())
        .filter(|ticket| !ticket.is_empty())
}

/// Posts the redeem form from the page it runs in, which lands where the
/// sign-in started.
fn submit_script(redeem: &Redeem) -> String {
    let fields = serde_json::json!({ "ticket": redeem.ticket, "verifier": redeem.verifier });
    format!(
        "(() => {{ const form = document.createElement('form'); form.method = 'post'; \
         form.action = '{REDEEM_PATH}'; \
         for (const [name, value] of Object.entries({fields})) {{ \
         const input = document.createElement('input'); input.type = 'hidden'; \
         input.name = name; input.value = value; form.append(input); }} \
         document.body.append(form); form.submit(); }})();"
    )
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    bytes
        .iter()
        .flat_map(|byte| {
            [
                DIGITS[usize::from(byte >> 4)],
                DIGITS[usize::from(byte & 0xf)],
            ]
        })
        .map(char::from)
        .collect()
}

fn new_verifier() -> Option<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).ok()?;
    Some(hex(&bytes))
}

/// The hex SHA-256 the site checks the verifier against.
fn challenge_of(verifier: &str) -> String {
    hex(&Sha256::digest(verifier.as_bytes()))
}

fn pending_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(PENDING_DIR))
}

fn keep_verifier<R: Runtime>(app: &AppHandle<R>, verifier: &str) -> std::io::Result<()> {
    let dir = pending_dir(app).ok_or(std::io::ErrorKind::NotFound)?;
    pending::keep(&dir, verifier)
}

fn take_verifier<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    pending::take(&pending_dir(app)?)
}

/// Sends a login that has to leave the webview to the system browser, with
/// a new verifier's challenge. False when `url` is no such login.
pub fn open_in_browser<R: Runtime>(app: &AppHandle<R>, url: &Url) -> bool {
    if !is_browser_login(url) {
        return false;
    }
    let Some(verifier) = new_verifier() else {
        log::warn!("no randomness for a sign-in verifier");
        return true;
    };
    if let Err(err) = keep_verifier(app, &verifier) {
        log::warn!("could not keep the sign-in verifier: {err}");
        return true;
    }
    if let Some(login) = browser_login(url, &challenge_of(&verifier)) {
        shell::open_outside(app, &login);
    }
    true
}

/// Takes the verifier out for an app link's ticket and keeps both for the
/// main window's next page of the site. False when no sign-in waits for it.
fn hold<R: Runtime>(app: &AppHandle<R>, link: &Url) -> bool {
    let Some(ticket) = ticket_of(link) else {
        return false;
    };
    let Some(verifier) = take_verifier(app) else {
        log::warn!("a sign-in link arrived with no sign-in waiting");
        return false;
    };
    let Ok(mut pending) = PENDING.lock() else {
        return false;
    };
    *pending = Some(Redeem { ticket, verifier });
    true
}

/// Posts the held ticket once the main window has loaded a page of the site.
fn submit_pending<R: Runtime>(webview: &Webview<R>, url: &Url) {
    if !url.host_str().is_some_and(shell::is_site_host) {
        return;
    }
    let Some(redeem) = PENDING.lock().ok().and_then(|mut pending| pending.take()) else {
        return;
    };
    if let Err(err) = webview.eval(submit_script(&redeem)) {
        log::warn!("could not finish signing in: {err}");
    }
}

/// An app link while the app runs: the main window goes to the site, and
/// the ticket is posted once that has loaded.
fn follow_link<R: Runtime>(app: &AppHandle<R>, link: &Url) {
    if !hold(app, link) {
        return;
    }
    let (Some(window), Some(home)) = (
        app.get_webview_window(shell::MAIN_WINDOW),
        shell::home_url(app),
    ) else {
        return;
    };
    if let Err(err) = window.navigate(home) {
        log::warn!("could not finish signing in: {err}");
    }
    #[cfg(desktop)]
    if let Err(err) = window.set_focus() {
        log::debug!("could not bring the app forward: {err}");
    }
}

/// The link that launched the app, looked at once the main window has
/// loaded: a cold start gets no event for it.
fn hold_launch_link<R: Runtime>(app: &AppHandle<R>) {
    if LAUNCH_LINK_SEEN.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(Some(links)) = app.deep_link().get_current() {
        for link in &links {
            hold(app, link);
        }
    }
}

/// Listens for the app's sign-in links, at launch and while it runs.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("sign-in")
        .setup(|app, _api| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            app.deep_link().register_all()?;
            let handle = app.clone();
            app.deep_link().on_open_url(move |event| {
                for link in &event.urls() {
                    follow_link(&handle, link);
                }
            });
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished && webview.label() == shell::MAIN_WINDOW {
                hold_launch_link(webview.app_handle());
                submit_pending(webview, payload.url());
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::{Redeem, browser_login, challenge_of, submit_script, ticket_of};
    use tauri::Url;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    fn login(value: &str) -> Option<String> {
        browser_login(&url(value), "c0ffee").map(String::from)
    }

    #[test]
    fn sends_google_sign_in_to_the_browser_with_the_challenge() {
        assert_eq!(
            login("https://events.ciphermaniac.com/api/auth/login/google?next=%2Fhost").as_deref(),
            Some(
                "https://events.ciphermaniac.com/api/auth/login/google?next=%2Fhost&app=1&challenge=c0ffee"
            )
        );
        assert_eq!(
            login("https://events.ciphermaniac.com/api/auth/login/google?next=%2Fsettings&link=1&app=1&challenge=old")
                .as_deref(),
            Some("https://events.ciphermaniac.com/api/auth/login/google?next=%2Fsettings&link=1&app=1&challenge=c0ffee")
        );
    }

    #[test]
    fn leaves_other_navigation_alone() {
        assert_eq!(
            login("https://events.ciphermaniac.com/api/auth/login/discord?next=%2F"),
            None
        );
        assert_eq!(
            login("https://events.ciphermaniac.com/api/auth/login/google/extra"),
            None
        );
        assert_eq!(login("https://events.ciphermaniac.com/settings"), None);
        assert_eq!(login("https://evil.example/api/auth/login/google"), None);
    }

    #[test]
    fn takes_tickets_only_from_the_apps_own_links() {
        let ticket = |link: &str| ticket_of(&url(link));
        assert_eq!(
            ticket("ciphermaniac-events://auth?ticket=abc_-1").as_deref(),
            Some("abc_-1")
        );
        assert_eq!(ticket("ciphermaniac-events://auth"), None);
        assert_eq!(ticket("ciphermaniac-events://auth?ticket="), None);
        assert_eq!(ticket("ciphermaniac-events://other?ticket=abc"), None);
        assert_eq!(ticket("https://auth/?ticket=abc"), None);
    }

    #[test]
    fn posts_the_ticket_as_a_form_with_its_fields_quoted() {
        let script = submit_script(&Redeem {
            ticket: "abc".into(),
            verifier: "it's\"<x>".into(),
        });
        assert!(script.contains("form.action = '/api/auth/redeem'"));
        assert!(script.contains(r#"{"ticket":"abc","verifier":"it's\"<x>"}"#));
    }

    #[test]
    fn challenges_with_the_sites_hash() {
        assert_eq!(
            challenge_of("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
