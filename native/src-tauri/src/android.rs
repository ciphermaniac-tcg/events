//! What the Android activity (MainActivity.kt) hears from the main window:
//! when a page starts and finishes loading, and a sign-in to open over the
//! app. The first page to finish lets the splash screen go, and each load
//! lets back recheck what it can do.

use tauri::{Runtime, Url, Webview, webview::PageLoadEvent};

/// Calls a method of the activity on its thread, with no argument or one string.
fn call_activity<R: Runtime>(webview: &Webview<R>, method: &'static str, arg: Option<String>) {
    let sent = webview.with_webview(move |platform| {
        platform.jni_handle().exec(move |env, activity, _webview| {
            let called = match arg {
                None => env.call_method(activity, method, "()V", &[]),
                Some(arg) => env.new_string(arg).and_then(|arg| {
                    env.call_method(activity, method, "(Ljava/lang/String;)V", &[(&arg).into()])
                }),
            };
            if let Err(err) = called {
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
    call_activity(webview, method, None);
}

/// Opens a sign-in that has to leave the webview in a Custom Tab over the app.
pub fn open_sign_in<R: Runtime>(webview: &Webview<R>, url: &Url) {
    call_activity(webview, "openSignIn", Some(url.to_string()));
}
