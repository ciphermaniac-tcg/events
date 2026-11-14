//! What the Android activity (MainActivity.kt) hears from the main window:
//! when a page starts and finishes loading. The first page to finish lets
//! the splash screen go, and each load lets back recheck what it can do.

use tauri::{Runtime, Webview, webview::PageLoadEvent};

/// Calls a method of the activity that takes no arguments, on its thread.
fn call_activity<R: Runtime>(webview: &Webview<R>, method: &'static str) {
    let sent = webview.with_webview(move |platform| {
        platform.jni_handle().exec(move |env, activity, _webview| {
            if let Err(err) = env.call_method(activity, method, "()V", &[]) {
                // A Java exception stays pending, and breaks the next call, until cleared.
                if env.exception_clear().is_err() {
                    log::warn!("could not clear the activity's exception");
                }
                log::warn!("the activity's {method} failed: {err}");
            }
        });
    });
    if let Err(err) = sent {
        log::warn!("could not reach the activity for {method}: {err}");
    }
}

/// Tells the activity about a page load in the main window.
pub fn page_load<R: Runtime>(webview: &Webview<R>, event: PageLoadEvent) {
    let method = match event {
        PageLoadEvent::Started => "onMainPageStarted",
        PageLoadEvent::Finished => "onMainPageFinished",
    };
    call_activity(webview, method);
}
