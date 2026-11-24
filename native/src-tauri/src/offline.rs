//! The app's own page when the site can't be reached, in place of the
//! engine's error page: it goes back to the page that failed on Retry, or by
//! itself when the connection comes back.
//!
//! The page (offline.html) is a placeholder until this screen's design
//! round. Windows and Linux catch the failed load here, and Android in its
//! activity (OfflinePage.kt), which takes the page from here. macOS still shows
//! `WebKit`'s error page: the failure arrives only at the navigation delegate,
//! which wry keeps for itself.

use tauri::Url;

const PAGE: &str = include_str!("offline.html");
const RETRY_SLOT: &str = "\"{{retry}}\"";

/// The page, set to go back to `retry`.
pub fn page(retry: &Url) -> String {
    // A string literal in a script: as JSON, and never closing the script.
    let target = serde_json::Value::from(retry.as_str())
        .to_string()
        .replace('<', "\\u003c");
    PAGE.replace(RETRY_SLOT, &target)
}

/// Whether a failed load gets the page: one from the web, never the app's
/// own pages.
fn shows_for(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

#[cfg(windows)]
pub use windows_hook::install;

#[cfg(windows)]
mod windows_hook {
    use tauri::Url;
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_WEB_ERROR_STATUS, COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
            ICoreWebView2, ICoreWebView2NavigationCompletedEventArgs,
            ICoreWebView2NavigationCompletedEventArgs2,
        },
        NavigationCompletedEventHandler, take_pwstr,
    };
    use windows::core::{BOOL, HSTRING, Interface, PWSTR, Result};

    use super::{page, shows_for};

    /// Turns off `WebView2`'s error page and shows the app's instead.
    pub fn install(webview: &ICoreWebView2) -> Result<()> {
        let handler = NavigationCompletedEventHandler::create(Box::new(|sender, args| {
            let (Some(webview), Some(args)) = (sender, args) else {
                return Ok(());
            };
            if unreachable(&args)? {
                show(&webview)?;
            }
            Ok(())
        }));
        let mut token = 0;
        // SAFETY: WebView2 calls on the UI thread, which `with_webview` runs on.
        unsafe {
            webview.Settings()?.SetIsBuiltInErrorPageEnabled(false)?;
            webview.add_NavigationCompleted(&handler, &raw mut token)
        }
    }

    /// Whether a page failed with no answer from its server. A stopped load
    /// is not a failure, and a server's own error page stays.
    fn unreachable(args: &ICoreWebView2NavigationCompletedEventArgs) -> Result<bool> {
        let mut success = BOOL::default();
        let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
        // SAFETY: WebView2 calls on the UI thread, inside the event.
        unsafe {
            args.IsSuccess(&raw mut success)?;
            args.WebErrorStatus(&raw mut status)?;
        }
        if success.as_bool() || status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
            return Ok(false);
        }
        let mut http_status = 0;
        if let Ok(args) = args.cast::<ICoreWebView2NavigationCompletedEventArgs2>() {
            // SAFETY: as above.
            unsafe { args.HttpStatusCode(&raw mut http_status)? };
        }
        Ok(http_status == 0)
    }

    fn show(webview: &ICoreWebView2) -> Result<()> {
        let mut source = PWSTR::null();
        // SAFETY: as above; the address is ours to free, which `take_pwstr` does.
        unsafe { webview.Source(&raw mut source)? };
        let Some(failed) = Url::parse(&take_pwstr(source)).ok().filter(shows_for) else {
            return Ok(());
        };
        // SAFETY: as above.
        unsafe { webview.NavigateToString(&HSTRING::from(page(&failed))) }
    }
}

#[cfg(target_os = "linux")]
pub use linux_hook::setup;

#[cfg(target_os = "linux")]
mod linux_hook {
    use tauri::{Runtime, Url, WebviewWindow};
    use webkit2gtk::{NetworkError, PolicyError, WebView, WebViewExt};

    use super::{page, shows_for};

    /// Hooks the main window's webview.
    pub fn setup<R: Runtime>(window: &WebviewWindow<R>) {
        if let Err(err) = window.with_webview(|webview| install(&webview.inner())) {
            log::warn!("could not reach the webview: {err}");
        }
    }

    /// Shows the app's page in place of `WebKit`'s when a page can't load,
    /// whether the network, the name lookup or the connection failed. A
    /// stopped load is not a failure, nor is a download or a navigation the
    /// app turned away (both policy errors).
    fn install(webview: &WebView) {
        webview.connect_load_failed(|webview, _event, address, error| {
            let unreachable = error.kind::<NetworkError>() != Some(NetworkError::Cancelled)
                && error.kind::<PolicyError>().is_none();
            let Some(failed) = Url::parse(address).ok().filter(shows_for) else {
                return false;
            };
            if unreachable {
                webview.load_alternate_html(&page(&failed), address, None);
            }
            unreachable
        });
    }
}

#[cfg(target_os = "android")]
mod android_hook {
    use tauri::Url;
    use tauri::wry::prelude::{JClass, JNIEnv, JString, jstring};

    use super::{page, shows_for};

    /// `OfflinePage.page` (OfflinePage.kt): the page for an address that
    /// failed to load, or null when it keeps the webview's own.
    #[unsafe(no_mangle)]
    pub extern "system" fn Java_com_ciphermaniac_events_OfflinePage_page<'local>(
        mut env: JNIEnv<'local>,
        _class: JClass<'local>,
        address: JString<'local>,
    ) -> jstring {
        let failed = env
            .get_string(&address)
            .ok()
            .and_then(|address| Url::parse(&String::from(address)).ok())
            .filter(shows_for);
        failed
            .and_then(|failed| env.new_string(page(&failed)).ok())
            .map_or(std::ptr::null_mut(), JString::into_raw)
    }
}

#[cfg(test)]
mod tests {
    use super::{page, shows_for};
    use tauri::Url;

    #[test]
    fn goes_back_to_the_page_that_failed() {
        let failed = Url::parse("https://events.ciphermaniac.com/host/ABCD?tab=pairings").unwrap();
        let page = page(&failed);
        assert!(page.contains(
            r#"location.replace("https://events.ciphermaniac.com/host/ABCD?tab=pairings")"#
        ));
        assert!(!page.contains("{{retry}}"));
        assert!(page.contains("You’re offline"));
        assert!(page.contains(">Retry</button>"));
    }

    #[test]
    fn never_closes_its_script_from_the_address() {
        let failed = Url::parse("https://events.ciphermaniac.com/#</script>").unwrap();
        assert!(!page(&failed).contains("#</script>"));
    }

    #[test]
    fn shows_only_for_pages_from_the_web() {
        assert!(shows_for(
            &Url::parse("https://events.ciphermaniac.com/").unwrap()
        ));
        assert!(!shows_for(&Url::parse("tauri://localhost/").unwrap()));
        assert!(!shows_for(&Url::parse("about:blank").unwrap()));
    }
}
