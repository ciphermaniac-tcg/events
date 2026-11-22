//! Sign-in with a provider that refuses the app's webview (Google). The app
//! sends the site's login to the system browser (a Custom Tab over the app on
//! Android) with the SHA-256 of a random verifier it keeps; the browser signs in and hands back a one-time ticket
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

use crate::{data_dir, pending, shell};

/// Providers whose sign-in has to leave the webview. Discord's works inside.
const BROWSER_PROVIDERS: &[&str] = &["google"];
const LOGIN_PATH: &str = "/api/auth/login/";
const REDEEM_PATH: &str = "/api/auth/redeem";
const BINDING_PATH: &str = "/api/auth/link-binding";
/// Where the site sends any sign-in that failed.
const FAILED_PATH: &str = "/settings?signin=failed";
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
    shell::is_site(url)
        && url
            .path()
            .strip_prefix(LOGIN_PATH)
            .is_some_and(|provider| BROWSER_PROVIDERS.contains(&provider))
}

/// The parameters the app adds to a login, replaced if the page sent its own.
const APP_PARAMS: &[&str] = &["app", "challenge", "attempt"];

/// The login as the system browser opens it: the page's own query plus the
/// app's flag, the challenge, and the attempt the link back will name.
fn browser_login(url: &Url, challenge: &str, attempt: &str) -> Option<Url> {
    if !is_browser_login(url) {
        return None;
    }
    let mut login = url.clone();
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| !APP_PARAMS.contains(&key.as_ref()))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    login
        .query_pairs_mut()
        .clear()
        .extend_pairs(kept)
        .append_pair("app", "1")
        .append_pair("challenge", challenge)
        .append_pair("attempt", attempt);
    Some(login)
}

fn query_value(url: &Url, name: &str) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

/// The ticket an app link hands over and the attempt it belongs to, when it
/// is one of the app's.
fn link_parts(link: &Url) -> Option<(String, String)> {
    if link.scheme() != LINK_SCHEME || link.host_str() != Some(LINK_HOST) {
        return None;
    }
    let ticket = query_value(link, "ticket").filter(|ticket| !ticket.is_empty())?;
    let attempt = query_value(link, "attempt").filter(|attempt| pending::is_attempt(attempt))?;
    Some((ticket, attempt))
}

/// Posts the redeem form from the page it runs in, which lands where the
/// sign-in started.
fn submit_script(redeem: &Redeem, origin: &str) -> String {
    let fields = serde_json::json!({ "ticket": redeem.ticket, "verifier": redeem.verifier });
    let origin = serde_json::Value::from(origin);
    format!(
        "(() => {{ if (location.origin !== {origin}) return; \
         const form = document.createElement('form'); form.method = 'post'; \
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

/// `N` random bytes in hex: 32 for a verifier, 16 for an attempt id.
fn random_hex<const N: usize>() -> Option<String> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).ok()?;
    Some(hex(&bytes))
}

/// The hex SHA-256 the site checks the verifier against.
fn challenge_of(verifier: &str) -> String {
    hex(&Sha256::digest(verifier.as_bytes()))
}

fn pending_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    data_dir::get(app).map(|dir| dir.join(PENDING_DIR))
}

fn keep_verifier<R: Runtime>(
    app: &AppHandle<R>,
    attempt: &str,
    verifier: &str,
) -> std::io::Result<()> {
    let dir = pending_dir(app).ok_or(std::io::ErrorKind::NotFound)?;
    pending::keep(&dir, attempt, verifier)
}

fn take_verifier<R: Runtime>(app: &AppHandle<R>, attempt: &str) -> Option<String> {
    pending::take(&pending_dir(app)?, attempt)
}

/// The attempt a login names and its verifier, when that attempt is waiting.
fn waiting_attempt<R: Runtime>(app: &AppHandle<R>, url: &Url) -> Option<(String, String)> {
    let attempt = query_value(url, "attempt")?;
    let verifier = pending::peek(&pending_dir(app)?, &attempt)?;
    Some((attempt, verifier))
}

/// Whether a login adds the provider to the signed-in account.
fn is_link(url: &Url) -> bool {
    query_value(url, "link").as_deref() == Some("1")
}

/// Has the page fetch the link's binding to its session, then open `login`
/// with it, which `open_in_browser` sends on as an attempt already waiting.
fn bind_script(challenge: &str, login: &Url) -> String {
    let challenge = serde_json::json!({ "challenge": challenge });
    let login = serde_json::Value::from(login.as_str());
    format!(
        "(() => {{ fetch('{BINDING_PATH}', {{ method: 'POST', \
         headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({challenge}) }}) \
         .then((answer) => (answer.ok ? answer.json() : Promise.reject(answer.status))) \
         .then(({{ binding }}) => {{ const login = new URL({login}); \
         login.searchParams.set('binding', binding); location.assign(login.href); }}) \
         .catch(() => location.assign('{FAILED_PATH}')); }})();"
    )
}

/// Starts an attempt for a login that has to leave the webview: a link
/// first fetches its binding in the page, anything else opens straight away.
fn start_attempt<R: Runtime>(webview: &Webview<R>, url: &Url) {
    let app = webview.app_handle();
    let (Some(verifier), Some(attempt)) = (random_hex::<32>(), random_hex::<16>()) else {
        log::warn!("no randomness for a sign-in verifier");
        return;
    };
    if let Err(err) = keep_verifier(app, &attempt, &verifier) {
        log::warn!("could not keep the sign-in verifier: {err}");
        return;
    }
    let challenge = challenge_of(&verifier);
    let Some(login) = browser_login(url, &challenge, &attempt) else {
        return;
    };
    if !is_link(url) {
        shell::open_sign_in(webview, &login);
    } else if let Err(err) = webview.eval(bind_script(&challenge, &login)) {
        log::warn!("could not bind the link to this session: {err}");
    }
}

/// Sends a login that has to leave the webview to the browser. One
/// naming an attempt that is waiting goes as that attempt (a link coming back
/// with its binding); any other starts a new one. False when `url` is no
/// such login.
pub fn open_in_browser<R: Runtime>(webview: &Webview<R>, url: &Url) -> bool {
    if !is_browser_login(url) {
        return false;
    }
    let app = webview.app_handle();
    match waiting_attempt(app, url) {
        Some((attempt, verifier)) => {
            if let Some(login) = browser_login(url, &challenge_of(&verifier), &attempt) {
                shell::open_sign_in(webview, &login);
            }
        }
        None => start_attempt(webview, url),
    }
    true
}

/// Takes out the verifier of the attempt an app link names and keeps it with
/// the link's ticket for the main window's next page of the site. False when
/// that attempt is not waiting; any other attempt is left as it was.
fn hold<R: Runtime>(app: &AppHandle<R>, link: &Url) -> bool {
    let Some((ticket, attempt)) = link_parts(link) else {
        return false;
    };
    let Some(verifier) = take_verifier(app, &attempt) else {
        log::warn!("a sign-in link arrived for no attempt waiting");
        return false;
    };
    let Ok(mut pending) = PENDING.lock() else {
        return false;
    };
    *pending = Some(Redeem { ticket, verifier });
    true
}

/// Posts the held ticket once the main window has loaded a page of the site,
/// and only from that origin: the script checks the page it runs in again.
fn submit_pending<R: Runtime>(webview: &Webview<R>, url: &Url) {
    if webview.label() != shell::MAIN_WINDOW || !shell::is_site(url) {
        return;
    }
    let Some(redeem) = PENDING.lock().ok().and_then(|mut pending| pending.take()) else {
        return;
    };
    let origin = url.origin().ascii_serialization();
    if let Err(err) = webview.eval(submit_script(&redeem, &origin)) {
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
/// loaded: a cold start gets no event for it. Read on a thread of its own,
/// since Android answers on the UI thread that reports the load, and its
/// ticket posted from the page that loaded.
fn hold_launch_link<R: Runtime>(webview: &Webview<R>, url: &Url) {
    if LAUNCH_LINK_SEEN.swap(true, Ordering::SeqCst) {
        return;
    }
    let webview = webview.clone();
    let url = url.clone();
    std::thread::spawn(move || {
        let app = webview.app_handle();
        if let Ok(Some(links)) = app.deep_link().get_current() {
            for link in &links {
                hold(app, link);
            }
        }
        submit_pending(&webview, &url);
    });
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
                hold_launch_link(webview, payload.url());
                submit_pending(webview, payload.url());
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::{Redeem, bind_script, browser_login, challenge_of, link_parts, submit_script};
    use tauri::Url;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    fn login(value: &str) -> Option<String> {
        browser_login(&url(value), "c0ffee", "a77e").map(String::from)
    }

    #[test]
    fn sends_google_sign_in_to_the_browser_with_the_challenge() {
        assert_eq!(
            login("https://events.ciphermaniac.com/api/auth/login/google?next=%2Fhost").as_deref(),
            Some(
                "https://events.ciphermaniac.com/api/auth/login/google?next=%2Fhost&app=1&challenge=c0ffee&attempt=a77e"
            )
        );
        assert_eq!(
            login("https://events.ciphermaniac.com/api/auth/login/google?next=%2Fsettings&link=1&app=1&challenge=old&attempt=0ld")
                .as_deref(),
            Some("https://events.ciphermaniac.com/api/auth/login/google?next=%2Fsettings&link=1&app=1&challenge=c0ffee&attempt=a77e")
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
    fn takes_tickets_only_from_the_apps_own_links_naming_an_attempt() {
        const ATTEMPT: &str = "0123456789abcdef0123456789abcdef";
        let parts = |link: &str| link_parts(&url(link));
        assert_eq!(
            parts(&format!(
                "ciphermaniac-events://auth?ticket=abc_-1&attempt={ATTEMPT}"
            )),
            Some(("abc_-1".to_owned(), ATTEMPT.to_owned()))
        );
        assert_eq!(
            parts("ciphermaniac-events://auth?ticket=abc"),
            None,
            "no attempt"
        );
        assert_eq!(
            parts("ciphermaniac-events://auth?ticket=abc&attempt=..%2Fx"),
            None
        );
        assert_eq!(
            parts(&format!("ciphermaniac-events://auth?attempt={ATTEMPT}")),
            None
        );
        assert_eq!(
            parts(&format!(
                "ciphermaniac-events://auth?ticket=&attempt={ATTEMPT}"
            )),
            None
        );
        assert_eq!(
            parts(&format!(
                "ciphermaniac-events://other?ticket=abc&attempt={ATTEMPT}"
            )),
            None
        );
        assert_eq!(
            parts(&format!("https://auth/?ticket=abc&attempt={ATTEMPT}")),
            None
        );
    }

    #[test]
    fn posts_the_ticket_as_a_form_with_its_fields_quoted() {
        let script = submit_script(
            &Redeem {
                ticket: "abc".into(),
                verifier: "it's\"<x>".into(),
            },
            "https://events.ciphermaniac.com",
        );
        assert!(
            script
                .contains(r#"if (location.origin !== "https://events.ciphermaniac.com") return;"#)
        );
        assert!(script.contains("form.action = '/api/auth/redeem'"));
        assert!(script.contains(r#"{"ticket":"abc","verifier":"it's\"<x>"}"#));
    }

    #[test]
    fn binds_a_link_in_the_page_before_it_leaves() {
        let login = url(
            "https://events.ciphermaniac.com/api/auth/login/google?link=1&app=1&challenge=c0ffee&attempt=a77e",
        );
        let script = bind_script("c0ffee", &login);
        assert!(script.contains("fetch('/api/auth/link-binding'"));
        assert!(script.contains(r#"JSON.stringify({"challenge":"c0ffee"})"#));
        assert!(script.contains(&format!("new URL(\"{login}\")")));
        assert!(script.contains("login.searchParams.set('binding', binding)"));
        assert!(script.contains("location.assign('/settings?signin=failed')"));
    }

    #[test]
    fn challenges_with_the_sites_hash() {
        assert_eq!(
            challenge_of("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
