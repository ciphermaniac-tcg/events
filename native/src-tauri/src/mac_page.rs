//! The Mac app's side of the site's pages (`mac_page.js`). The main window
//! stays unseen until the page has drawn real content (`page_shown`), so a
//! launch never shows a blank window, the page's colour before its own, or a
//! skeleton; a page that never says so shows after a while anyway
//! (`shell.rs`). A right click gets the system's text menu where text is
//! selected or typed, and no menu elsewhere, never `WebKit`'s browser items.

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

/// Puts the window on screen but fully transparent, so `WebKit` draws the
/// page as in a shown window: a hidden one runs no frames and paints nothing,
/// so the page could never say it had drawn. On the main thread, before the
/// window is first shown.
#[cfg(target_os = "macos")]
pub fn show_unseen<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    set_alpha(window, 0.0);
    if let Err(err) = window.show() {
        log::warn!("could not show the window: {err}");
    }
}

/// Makes the window seen and brings it forward, as showing it would, from
/// any thread: shown unseen this early in the launch, the app was never
/// brought forward.
#[cfg(target_os = "macos")]
pub fn reveal<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let seen = window.clone();
    let revealed = window.run_on_main_thread(move || {
        set_alpha(&seen, 1.0);
        if let Err(err) = seen.set_focus() {
            log::warn!("could not bring the window forward: {err}");
        }
    });
    if let Err(err) = revealed {
        log::warn!("could not show the window: {err}");
    }
}

#[cfg(target_os = "macos")]
fn set_alpha<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, alpha: f64) {
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    // SAFETY: the window's own NSWindow, on the main thread.
    unsafe {
        let ns_window: &objc2::runtime::AnyObject = &*ns_window.cast();
        let () = objc2::msg_send![ns_window, setAlphaValue: alpha];
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
