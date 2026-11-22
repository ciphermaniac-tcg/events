//! Downloads on Windows ask where to save, as a Windows app does, rather than
//! landing in Downloads behind Edge's download flyout. The site's exports
//! and share images arrive this way.

use std::path::{Path, PathBuf};

use tauri::{Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use webview2_com::{
    DownloadStartingEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2_4, ICoreWebView2Deferral,
        ICoreWebView2DownloadStartingEventArgs,
    },
    take_pwstr,
};
use windows::core::{HSTRING, Interface, PWSTR, Result};

/// Asks where to save each download the webview starts.
pub fn install<R: Runtime>(webview: &ICoreWebView2, window: WebviewWindow<R>) -> Result<()> {
    let webview: ICoreWebView2_4 = webview.cast()?;
    let handler = DownloadStartingEventHandler::create(Box::new(move |_, args| {
        args.map_or(Ok(()), |args| ask(&window, args))
    }));
    let mut token = 0;
    // SAFETY: a WebView2 call on the UI thread, which `with_webview` runs on.
    unsafe { webview.add_DownloadStarting(&handler, &raw mut token) }
}

/// A download held until the save dialog answers.
struct Waiting {
    args: ICoreWebView2DownloadStartingEventArgs,
    deferral: ICoreWebView2Deferral,
}

// SAFETY: made on the UI thread and used only there: the dialog's answer
// comes back to it through `run_on_main_thread` before `finish` runs.
unsafe impl Send for Waiting {}

impl Waiting {
    /// Saves where the dialog says, or cancels when it was dismissed. The
    /// download is let go however that went, so it never hangs.
    fn finish(self, path: Option<&Path>) -> Result<()> {
        // SAFETY: WebView2 calls on the UI thread (see `Send` above).
        unsafe {
            let answered = match path {
                Some(path) => self.args.SetResultFilePath(&HSTRING::from(path)),
                None => self.args.SetCancel(true),
            };
            let completed = self.deferral.Complete();
            answered.and(completed)
        }
    }
}

fn ask<R: Runtime>(
    window: &WebviewWindow<R>,
    args: ICoreWebView2DownloadStartingEventArgs,
) -> Result<()> {
    let mut suggested = PWSTR::null();
    // SAFETY: WebView2 calls on the UI thread, inside the event; the path is
    // ours to free, which `take_pwstr` does.
    let deferral = unsafe {
        // Handled: no download flyout.
        args.SetHandled(true)?;
        args.ResultFilePath(&raw mut suggested)?;
        args.GetDeferral()?
    };
    let suggested = PathBuf::from(take_pwstr(suggested));
    let waiting = Waiting { args, deferral };
    let mut dialog = window.dialog().file().set_parent(window);
    if let Some(name) = suggested.file_name() {
        dialog = dialog.set_file_name(name.to_string_lossy());
    }
    if let Some(folder) = suggested.parent() {
        dialog = dialog.set_directory(folder);
    }
    let app = window.app_handle().clone();
    dialog.save_file(move |chosen| {
        let path = chosen.and_then(|chosen| chosen.into_path().ok());
        let finished = app.run_on_main_thread(move || {
            if let Err(err) = waiting.finish(path.as_deref()) {
                log::warn!("could not save the download: {err}");
            }
        });
        if let Err(err) = finished {
            log::warn!("could not save the download: {err}");
        }
    });
    Ok(())
}
