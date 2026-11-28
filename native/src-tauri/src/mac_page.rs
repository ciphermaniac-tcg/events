//! The Mac app's side of the site's pages (`mac_page.js`). The main window
//! stays hidden until the page has drawn real content (`page_shown`), so a
//! launch never shows a blank window, the page's colour before its own, or a
//! skeleton; a page that never says so shows after a while anyway
//! (`shell.rs`). A right click gets the system's text menu where text is
//! selected or typed, and no menu elsewhere, never `WebKit`'s browser items.
//! Edit > Find (`menu.rs`) goes to the page's own search, where it shows one,
//! and a two-finger swipe goes back and forward.

/// The page script, on the site's pages only.
#[cfg(any(target_os = "macos", test))]
fn script_for(site: &str) -> String {
    format!(
        "(() => {{ if (location.hostname !== '{site}') return; \
         ({})((command, args) => window.__TAURI_INTERNALS__.invoke(command, args).catch(() => {{}})); }})();",
        include_str!("mac_page.js").trim_end()
    )
}

#[cfg(target_os = "macos")]
pub fn script() -> String {
    script_for(crate::shell::SITE_HOST)
}

/// The window's webview takes the trackpad's two-finger swipe back and
/// forward, as Safari does; `WebKit` leaves it off, and Tauri has no setting.
#[cfg(target_os = "macos")]
pub fn swipe_back_and_forward<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    // SAFETY: on the Mac the platform webview is the window's WKWebView, on
    // the main thread, where `with_webview` runs.
    let set = window.with_webview(|webview| unsafe {
        let webview: &objc2_web_kit::WKWebView = &*webview.inner().cast();
        webview.setAllowsBackForwardNavigationGestures(true);
    });
    if let Err(err) = set {
        log::warn!("could not reach the webview: {err}");
    }
}

/// The page has drawn real content.
#[cfg(target_os = "macos")]
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its arguments by value"
)]
pub fn page_shown<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    crate::shell::show_main_window(&app);
}

#[cfg(test)]
mod tests {
    use super::script_for;

    #[test]
    fn runs_on_the_sites_pages_only() {
        let script = script_for("events.ciphermaniac.com");
        assert!(
            script.starts_with(
                "(() => { if (location.hostname !== 'events.ciphermaniac.com') return;"
            )
        );
        assert!(script.contains("invoke('page_shown')"));
        assert!(script.contains("'contextmenu'"));
    }
}
