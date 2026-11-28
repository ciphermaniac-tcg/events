//! Audit probe (native/mac-feel-audit only, never merged). Native moments
//! and the page's own timings go to stderr as `FEEL <epoch ms> <source>
//! <name> <detail>` lines for native/screens/feel-mac.py, which also sends the
//! page scripts to run through the file named by `FEEL_CMD`.

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, Runtime};

fn epoch_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// Notes a native moment.
pub fn note(name: &str, detail: &str) {
    eprintln!("FEEL {:.1} native {name} {detail}", epoch_ms());
}

/// The page's report, already one line.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn feel_note(line: String) {
    eprintln!("FEEL {:.1} page {}", epoch_ms(), line.replace('\n', " "));
}

/// The probe each page runs first.
pub const PROBE: &str = include_str!("feel_probe.js");

/// Runs each script the driver leaves in `FEEL_CMD` in the main window.
pub fn watch_commands<R: Runtime>(app: &AppHandle<R>) {
    let Ok(path) = std::env::var("FEEL_CMD") else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(20));
            let Ok(js) = std::fs::read_to_string(&path) else {
                continue;
            };
            if js.trim().is_empty() {
                continue;
            }
            let _ = std::fs::write(&path, "");
            note("eval", &js.len().to_string());
            if let Some(window) = app.get_webview_window(crate::shell::MAIN_WINDOW)
                && let Err(err) = window.eval(js)
            {
                note("eval-error", &err.to_string());
            }
        }
    });
}

/// Prototype of a local-first launch on the Mac: when `FEEL_SIMULATE` names
/// a kept copy of the site's page (every route is the same index.html), the
/// window loads it at once as the response for its own address, with the
/// site's origin, cookies and policy, and asks the network only for what the
/// page then loads (`loadSimulatedRequest`, macOS 12).
#[cfg(target_os = "macos")]
pub fn simulated_launch<R: Runtime>(window: &tauri::WebviewWindow<R>, url: &str) {
    let Ok(path) = std::env::var("FEEL_SIMULATE") else {
        return;
    };
    let Ok(html) = std::fs::read(&path) else {
        note("simulate-missing", &path);
        return;
    };
    let csp = std::fs::read_to_string(format!("{path}.csp")).unwrap_or_default();
    let url = url.to_owned();
    note("simulate", &url);
    let done = window.with_webview(move |webview| {
        use objc2::{AnyThread, rc::Retained};
        use objc2_foundation::{
            NSData, NSDictionary, NSHTTPURLResponse, NSString, NSURL, NSURLRequest,
        };
        use objc2_web_kit::WKWebView;
        let Some(address) = NSURL::URLWithString(&NSString::from_str(&url)) else {
            note("simulate-bad-url", &url);
            return;
        };
        let request = NSURLRequest::requestWithURL(&address);
        let keys = [
            NSString::from_str("Content-Type"),
            NSString::from_str("Content-Security-Policy"),
        ];
        let values = [
            NSString::from_str("text/html; charset=utf-8"),
            NSString::from_str(csp.trim()),
        ];
        let headers: Retained<NSDictionary<NSString, NSString>> =
            NSDictionary::from_slices(&[&*keys[0], &*keys[1]], &[&*values[0], &*values[1]]);
        let Some(response) = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(
            NSHTTPURLResponse::alloc(),
            &address,
            200,
            Some(&NSString::from_str("HTTP/1.1")),
            Some(&headers),
        ) else {
            note("simulate-no-response", "");
            return;
        };
        let data = NSData::with_bytes(&html);
        // SAFETY: on the Mac the platform webview is the window's WKWebView.
        unsafe {
            let wk: &WKWebView = &*webview.inner().cast();
            wk.loadSimulatedRequest_response_responseData(&request, &response, &data);
        }
        note("simulated", "");
    });
    if let Err(err) = done {
        note("simulate-error", &err.to_string());
    }
}
