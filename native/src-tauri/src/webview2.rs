//! The main window's `WebView2` on Windows, for what Tauri doesn't wrap.
//! Each part hooks the webview once, right after the window is built, and
//! one that can't (on an older runtime) leaves the others working.

use tauri::{Runtime, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller;

/// Hooks the main window's webview.
pub fn setup<R: Runtime>(window: &WebviewWindow<R>) {
    let hooked = window.with_webview(|webview| install(&webview.controller()));
    if let Err(err) = hooked {
        log::warn!("could not reach the webview: {err}");
    }
}

fn install(controller: &ICoreWebView2Controller) {
    // SAFETY: a WebView2 call on the UI thread, which `with_webview` runs on.
    let webview = match unsafe { controller.CoreWebView2() } {
        Ok(webview) => webview,
        Err(err) => {
            log::warn!("could not reach the webview: {err}");
            return;
        }
    };
    hooked("right-click menu", crate::context_menu::install(&webview));
}

fn hooked(part: &str, result: windows::core::Result<()>) {
    if let Err(err) = result {
        log::warn!("could not set up the webview's {part}: {err}");
    }
}
