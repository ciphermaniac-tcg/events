//! The app's own page when the site can't be reached, in place of the
//! engine's error page: it goes back to the page that failed on Retry, or by
//! itself when the connection comes back.
//!
//! The page (offline.html) is a placeholder until this screen's design
//! round. Each platform catches the failed load its own way; on the Mac,
//! where the window otherwise stays empty, the failure reaches only the
//! navigation delegate, which wry keeps, so the app adds the one method wry
//! leaves out to it.

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

/// Whether a load that failed before its page came failed for want of a
/// server (`NSURLErrorDomain`): not one stopped (-999), and not one `WebKit`
/// turned away itself, such as a download.
#[cfg(any(target_os = "macos", test))]
fn unreachable(domain: &str, code: isize) -> bool {
    domain == "NSURLErrorDomain" && code != -999
}

#[cfg(target_os = "macos")]
pub use mac_hook::setup;

#[cfg(target_os = "macos")]
mod mac_hook {
    use std::sync::OnceLock;

    use objc2::{
        ffi,
        rc::Retained,
        runtime::{AnyClass, AnyObject, Imp, Sel},
        sel,
    };
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_web_kit::WKWebView;
    use tauri::{Manager, Runtime, Url, WebviewWindow};

    use super::{page, shows_for, unreachable};

    /// The method added, as the runtime calls it.
    type Failed =
        unsafe extern "C-unwind" fn(&AnyObject, Sel, &WKWebView, *mut AnyObject, &NSError);

    /// Shows the main window once the page stands in for one that never came.
    static SHOW: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

    /// Hooks the main window's webview.
    pub fn setup<R: Runtime>(window: &WebviewWindow<R>) {
        let app = window.app_handle().clone();
        let _ = SHOW.set(Box::new(move || crate::shell::show_main_window(&app)));
        // SAFETY: on the Mac the platform webview is the window's WKWebView.
        let hooked = window.with_webview(|webview| unsafe { install(&*webview.inner().cast()) });
        if let Err(err) = hooked {
            log::warn!("could not reach the webview: {err}");
        }
    }

    /// Adds `webView:didFailProvisionalNavigation:withError:` to the class of
    /// wry's navigation delegate, which has none, then hands the delegate
    /// over again so `WebKit` asks it what it answers.
    unsafe fn install(webview: &WKWebView) {
        // SAFETY: on the main thread, where `with_webview` runs.
        unsafe {
            let Some(delegate) = webview.navigationDelegate() else {
                return;
            };
            let object: &AnyObject = delegate.as_ref();
            let class = std::ptr::from_ref::<AnyClass>(object.class()).cast_mut();
            let imp = std::mem::transmute::<Failed, Imp>(failed);
            ffi::class_addMethod(
                class,
                sel!(webView:didFailProvisionalNavigation:withError:),
                imp,
                c"v@:@@@".as_ptr(),
            );
            webview.setNavigationDelegate(Some(&delegate));
        }
    }

    /// Shows the app's page where a page from the web never came.
    unsafe extern "C-unwind" fn failed(
        _delegate: &AnyObject,
        _cmd: Sel,
        webview: &WKWebView,
        _navigation: *mut AnyObject,
        error: &NSError,
    ) {
        if !unreachable(&error.domain().to_string(), error.code()) {
            return;
        }
        let address = error
            .userInfo()
            .objectForKey(&NSString::from_str("NSErrorFailingURLKey"))
            .and_then(|url| url.downcast::<NSURL>().ok())
            .and_then(|url: Retained<NSURL>| url.absoluteString());
        let Some(failed) = address
            .and_then(|address| Url::parse(&address.to_string()).ok())
            .filter(shows_for)
        else {
            return;
        };
        // SAFETY: WebKit calls its delegate on the main thread.
        unsafe { webview.loadHTMLString_baseURL(&NSString::from_str(&page(&failed)), None) };
        if let Some(show) = SHOW.get() {
            show();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{page, shows_for, unreachable};

    #[test]
    fn stands_in_only_for_a_page_no_server_answered() {
        assert!(unreachable("NSURLErrorDomain", -1004), "could not connect");
        assert!(unreachable("NSURLErrorDomain", -1009), "offline");
        assert!(!unreachable("NSURLErrorDomain", -999), "stopped");
        assert!(
            !unreachable("WebKitErrorDomain", 102),
            "turned away by WebKit"
        );
    }
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
