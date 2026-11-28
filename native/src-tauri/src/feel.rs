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
