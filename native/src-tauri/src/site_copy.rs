//! The Mac app's own copy of the site's page, loaded in place of the network
//! for a launch's first page, so a launch draws without waiting a round trip
//! for the page. `WebKit` takes it as the answer for the page's own address
//! (`loadSimulatedRequest`), so the page keeps the site's origin, cookies and
//! policy, and everything it loads goes to the network as ever: its built
//! files from `WebKit`'s cache, its data fresh.
//!
//! The rules are the Android shell's (`SiteCache.kt`):
//! - Only the page is kept, the same for every route and everyone, with the
//!   headers that guard it. No data, no write and nothing of an account.
//! - Only a launch's first page, only for one of the site's routes, and only
//!   while the Mac is online; offline, the offline page stands in as ever.
//! - A launch the copy serves leaves a mark. The page looks at the live page
//!   a few seconds after it shows, and on coming back after a minute away
//!   (`mac_page.js`). A new deploy is kept marked, so the next launch loads
//!   it from the site, which fills `WebKit`'s cache with its files before the
//!   copy serves it; the mark goes only when a launch that drew the site's
//!   page finds the live page is the one kept and kept no new deploy itself.
//!   A launch whose look didn't finish leaves its mark too, so a deploy
//!   always reaches the app within one launch, and the app never runs old
//!   code against a newer API.

use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::Url;

/// The site's routes (src/main.tsx), each answered with the same page; a
/// segment of `*` is any one segment.
const ROUTES: &[&str] = &[
    "/",
    "/host",
    "/host/*",
    "/t/*",
    "/settings",
    "/sign-in",
    "/create-account",
    "/account",
    "/history",
    "/u/*",
    "/apply",
    "/welcome",
    "/privacy",
    "/terms",
    "/admin",
    "/stores/*",
    "/stores/*/settings",
];

/// The headers that guard the page (static/_headers), kept with it; the rest
/// change with each answer.
const KEPT_HEADERS: &[&str] = &[
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "x-frame-options",
    "strict-transport-security",
];

const SHELL_FILE: &str = "shell.json";
const OWED_FILE: &str = "look-owed";

/// The site's page drew in this run, so `WebKit`'s cache holds what it loads.
#[cfg(target_os = "macos")]
static SITE_SHOWN: AtomicBool = AtomicBool::new(false);
/// This run kept a new deploy, so its mark stays.
#[cfg(target_os = "macos")]
static DEPLOY_KEPT: AtomicBool = AtomicBool::new(false);

/// The kept page and its headers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kept {
    pub headers: BTreeMap<String, String>,
    pub html: String,
}

/// The live page as the page's look fetched it (`mac_page.js`).
#[derive(Debug, Deserialize)]
pub struct Live {
    status: u16,
    mime: String,
    headers: BTreeMap<String, String>,
    html: String,
}

fn is_route(path: &str) -> bool {
    let segments: Vec<&str> = path.split('/').collect();
    ROUTES.iter().any(|route| {
        let parts: Vec<&str> = route.split('/').collect();
        parts.len() == segments.len()
            && parts
                .iter()
                .zip(&segments)
                .all(|(part, segment)| *part == *segment || (*part == "*" && !segment.is_empty()))
    })
}

/// Whether a launch's first page may come from the copy: one of the live
/// site's routes.
pub fn serves(url: &Url) -> bool {
    crate::shell::is_site_at(url, false) && is_route(url.path())
}

/// Writes whole or not at all; true when written.
fn write(path: &Path, bytes: &[u8]) -> bool {
    let part = path.with_extension("part");
    let written = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(&part, bytes))
        .and_then(|()| fs::rename(&part, path));
    if let Err(err) = &written {
        log::debug!("could not keep {}: {err}", path.display());
        let _ = fs::remove_file(&part);
    }
    written.is_ok()
}

fn read(dir: &Path) -> Option<Kept> {
    serde_json::from_slice(&fs::read(dir.join(SHELL_FILE)).ok()?).ok()
}

/// The copy for this launch's first page, once its mark is down: none while
/// offline, before there is one, or while a look is owed. Serving it leaves
/// the mark, or doesn't serve.
pub fn launch_page(dir: &Path, online: bool) -> Option<Kept> {
    if !online || dir.join(OWED_FILE).exists() {
        return None;
    }
    read(dir).filter(|_| write(&dir.join(OWED_FILE), b""))
}

/// The site's page drew in this run.
#[cfg(target_os = "macos")]
pub fn site_shown() {
    SITE_SHOWN.store(true, Ordering::Relaxed);
}

/// Takes in a look at the live page: a new deploy is marked first, then
/// kept with its headers in one write; the one kept lifts the mark, once
/// the site's page has drawn and unless this run kept a new deploy.
fn keep_at(dir: &Path, live: Live, shown: bool, deploy_kept: &AtomicBool) {
    if live.status != 200
        || !live.mime.to_ascii_lowercase().starts_with("text/html")
        || !live.html.contains("/assets/")
    {
        return;
    }
    let headers = live
        .headers
        .into_iter()
        .map(|(name, value)| (name.to_ascii_lowercase(), value))
        .filter(|(name, _)| KEPT_HEADERS.contains(&name.as_str()))
        .collect();
    let kept = Kept {
        headers,
        html: live.html,
    };
    if read(dir).as_ref() != Some(&kept) {
        if let Ok(bytes) = serde_json::to_vec(&kept)
            && write(&dir.join(OWED_FILE), b"")
        {
            deploy_kept.store(true, Ordering::Relaxed);
            write(&dir.join(SHELL_FILE), &bytes);
        }
        return;
    }
    if shown && !deploy_kept.load(Ordering::Relaxed) {
        let _ = fs::remove_file(dir.join(OWED_FILE));
    }
}

/// Where the copy lives.
#[cfg(target_os = "macos")]
fn dir_of<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<std::path::PathBuf> {
    crate::data_dir::get(app).map(|dir| dir.join("site"))
}

/// The page's look at the live page (`mac_page.js`).
#[cfg(target_os = "macos")]
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its arguments by value"
)]
pub fn site_copy_keep<R: tauri::Runtime>(app: tauri::AppHandle<R>, page: Live) {
    if let Some(dir) = dir_of(&app) {
        keep_at(&dir, page, SITE_SHOWN.load(Ordering::Relaxed), &DEPLOY_KEPT);
    }
}

/// The copy for the main window's first page, `url`, when it may serve.
#[cfg(target_os = "macos")]
pub fn for_launch<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &Url) -> Option<Kept> {
    if !serves(url) || std::env::var_os("FEEL_NO_COPY").is_some() {
        return None;
    }
    let kept = launch_page(&dir_of(app)?, online());
    crate::feel::note(if kept.is_some() { "copy-served" } else { "copy-not-served" }, url.as_str());
    kept
}

/// Whether the Mac has a network that reaches beyond itself.
#[cfg(target_os = "macos")]
fn online() -> bool {
    use system_configuration::network_reachability::{ReachabilityFlags, SCNetworkReachability};
    SCNetworkReachability::from(std::net::SocketAddr::from(([0, 0, 0, 0], 0)))
        .reachability()
        .is_ok_and(|flags| {
            flags.contains(ReachabilityFlags::REACHABLE)
                && !flags.contains(ReachabilityFlags::CONNECTION_REQUIRED)
        })
}

/// Loads the kept page into `window` as the answer for `url`, asking
/// `WebKit` to open the site's connection at once, as fetching the page
/// would have. Without `loadSimulatedRequest` (macOS 11), the page loads
/// from the site.
#[cfg(target_os = "macos")]
pub fn load<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, url: &Url, kept: Kept) {
    let address = url.to_string();
    let origin = url.origin().ascii_serialization();
    let fallback = window.clone();
    let fallback_url = url.clone();
    let loaded = window.with_webview(move |webview| {
        use objc2::{AnyThread, runtime::NSObjectProtocol, sel};
        use objc2_foundation::{
            NSData, NSDictionary, NSHTTPURLResponse, NSString, NSURL, NSURLRequest,
        };
        // SAFETY: on the Mac the platform webview is the window's WKWebView,
        // on the main thread, where `with_webview` runs.
        let wk: &objc2_web_kit::WKWebView = unsafe { &*webview.inner().cast() };
        let simulated = wk.respondsToSelector(sel!(loadSimulatedRequest:response:responseData:));
        let Some(page) = NSURL::URLWithString(&NSString::from_str(&address)).filter(|_| simulated)
        else {
            let _ = fallback.navigate(fallback_url);
            return;
        };
        let mut headers = kept.headers;
        headers.insert("content-type".into(), "text/html; charset=utf-8".into());
        headers.insert("link".into(), format!("<{origin}>; rel=preconnect"));
        let names: Vec<_> = headers
            .keys()
            .map(|name| NSString::from_str(name))
            .collect();
        let values: Vec<_> = headers
            .values()
            .map(|value| NSString::from_str(value))
            .collect();
        let names: Vec<&NSString> = names.iter().map(|name| &**name).collect();
        let values: Vec<&NSString> = values.iter().map(|value| &**value).collect();
        let fields = NSDictionary::from_slices(&names, &values);
        let response = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(
            NSHTTPURLResponse::alloc(),
            &page,
            200,
            Some(&NSString::from_str("HTTP/1.1")),
            Some(&fields),
        );
        let Some(response) = response else {
            let _ = fallback.navigate(fallback_url);
            return;
        };
        let request = NSURLRequest::requestWithURL(&page);
        let data = NSData::with_bytes(kept.html.as_bytes());
        // SAFETY: as above.
        unsafe { wk.loadSimulatedRequest_response_responseData(&request, &response, &data) };
    });
    if let Err(err) = loaded {
        log::warn!("could not load the kept page: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::{Kept, Live, OWED_FILE, SHELL_FILE, is_route, keep_at, launch_page, serves};
    use std::{
        collections::BTreeMap,
        fs,
        path::PathBuf,
        sync::atomic::{AtomicBool, Ordering},
    };
    use tauri::Url;

    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("site-copy-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn live(html: &str) -> Live {
        Live {
            status: 200,
            mime: "text/html; charset=utf-8".into(),
            headers: BTreeMap::from([
                (
                    "Content-Security-Policy".into(),
                    "default-src 'self'".into(),
                ),
                ("Set-Cookie".into(), "cm_session=secret".into()),
                ("Date".into(), "today".into()),
            ]),
            html: html.into(),
        }
    }

    #[test]
    fn serves_the_live_sites_routes_only() {
        let url = |url: &str| Url::parse(url).unwrap();
        assert!(serves(&url("https://events.ciphermaniac.com/")));
        assert!(serves(&url(
            "https://events.ciphermaniac.com/host/ABCD?tab=pairings"
        )));
        assert!(serves(&url(
            "https://events.ciphermaniac.com/stores/7/settings"
        )));
        assert!(!serves(&url("https://events.ciphermaniac.com/api/me")));
        assert!(!serves(&url(
            "https://events.ciphermaniac.com/assets/app.js"
        )));
        assert!(!serves(&url("https://discord.com/")));
        assert!(!is_route("/t/"), "a code is one segment, never none");
        assert!(!is_route("/host/ABCD/extra"));
    }

    #[test]
    fn keeps_only_the_page_and_its_guarding_headers() {
        let dir = dir("keep");
        keep_at(
            &dir,
            live("<script src=/assets/a.js>"),
            true,
            &AtomicBool::new(false),
        );
        let kept: Kept = serde_json::from_slice(&fs::read(dir.join(SHELL_FILE)).unwrap()).unwrap();
        assert_eq!(
            kept.headers.keys().collect::<Vec<_>>(),
            ["content-security-policy"]
        );
        assert!(dir.join(OWED_FILE).exists(), "a new deploy is kept marked");
        for refused in [
            Live {
                status: 302,
                ..live("/assets/")
            },
            Live {
                mime: "application/json".into(),
                ..live("/assets/")
            },
            live("<p>no built files</p>"),
        ] {
            let other = self::dir("refused");
            keep_at(&other, refused, true, &AtomicBool::new(false));
            assert!(!other.join(SHELL_FILE).exists());
        }
    }

    #[test]
    fn serves_once_online_with_no_look_owed_and_marks_what_it_serves() {
        let dir = dir("serve");
        assert_eq!(launch_page(&dir, true), None, "nothing kept yet");
        keep_at(&dir, live("/assets/"), false, &AtomicBool::new(false));
        assert_eq!(
            launch_page(&dir, true),
            None,
            "a new deploy loads from the site first"
        );
        fs::remove_file(dir.join(OWED_FILE)).unwrap();
        assert_eq!(
            launch_page(&dir, false),
            None,
            "offline, the network as ever"
        );
        assert!(launch_page(&dir, true).is_some());
        assert!(dir.join(OWED_FILE).exists(), "serving leaves a mark");
        assert_eq!(launch_page(&dir, true), None, "until a look lifts it");
    }

    #[test]
    fn lifts_the_mark_only_for_a_run_that_drew_the_site_and_kept_no_deploy() {
        let dir = dir("lift");
        keep_at(&dir, live("/assets/v1"), true, &AtomicBool::new(false));
        let kept_now = AtomicBool::new(false);
        keep_at(&dir, live("/assets/v1"), false, &kept_now);
        assert!(dir.join(OWED_FILE).exists(), "the page never drew");
        let deployed = AtomicBool::new(false);
        keep_at(&dir, live("/assets/v2"), true, &deployed);
        assert!(deployed.load(Ordering::Relaxed));
        keep_at(&dir, live("/assets/v2"), true, &deployed);
        assert!(dir.join(OWED_FILE).exists(), "this run kept the deploy");
        keep_at(&dir, live("/assets/v2"), true, &AtomicBool::new(false));
        assert!(
            !dir.join(OWED_FILE).exists(),
            "the next run's matching look lifts it"
        );
    }
}
