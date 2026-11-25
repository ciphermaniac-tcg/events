//! On the Mac, closing the main window (its close button, or Cmd+W) leaves
//! the app running in the Dock, as a Mac app does: the window hides rather
//! than closes, so it comes back as it was, on its page. Clicking the Dock
//! icon brings it back, as do the app's menu commands for it
//! (`menu.rs`). Quit ends the app; the big screen window closes for good,
//! as any other window does.

use tauri::{AppHandle, RunEvent, Runtime, WebviewWindow, WindowEvent};

use crate::shell;

/// Hides the main window when it is closed.
pub fn hide_on_close<R: Runtime>(window: &WebviewWindow<R>) {
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(err) = hidden.hide() {
                log::warn!("could not hide the window: {err}");
            }
        }
    });
}

/// Brings the main window back when the Dock icon is clicked while it is
/// hidden, even with the big screen still showing.
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    if let RunEvent::Reopen { .. } = event {
        shell::reveal_main_window(app);
    }
}
