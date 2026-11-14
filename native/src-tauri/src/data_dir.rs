//! The app's data directory, found once at launch. On Android, finding it
//! asks the app's Kotlin side and waits for the answer on Android's UI
//! thread, the thread that reports page loads and navigations: asked from
//! one of those, it never answers and the app hangs.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

struct DataDir(Option<PathBuf>);

/// Finds the directory; called from the app's setup, off the UI thread.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    app.manage(DataDir(app.path().app_data_dir().ok()));
}

/// The directory, when it was found.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.try_state::<DataDir>()?.0.clone()
}
