//! Desktop updates: check once on launch, ask, then download, install and
//! restart. The live site gets no updater permission; this runs in Rust.

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};

pub fn check_on_launch<R: Runtime>(app: &AppHandle<R>) {
  if cfg!(debug_assertions) {
    return;
  }
  let app = app.clone();
  tauri::async_runtime::spawn(async move {
    match find(&app).await {
      Ok(Some(update)) => offer(app, update),
      Ok(None) => {}
      Err(err) => log::warn!("update check failed: {err}"),
    }
  });
}

async fn find<R: Runtime>(app: &AppHandle<R>) -> tauri_plugin_updater::Result<Option<Update>> {
  app.updater()?.check().await
}

fn offer<R: Runtime>(app: AppHandle<R>, update: Update) {
  let message = format!(
    "Ciphermaniac Events {} is ready. The app restarts to install it.",
    update.version
  );
  let dialog = app.dialog().clone();
  dialog
    .message(message)
    .title("Update available")
    .buttons(MessageDialogButtons::OkCancelCustom(
      "Install and restart".into(),
      "Later".into(),
    ))
    .show(move |confirmed| {
      if confirmed {
        tauri::async_runtime::spawn(install(app, update));
      }
    });
}

async fn install<R: Runtime>(app: AppHandle<R>, update: Update) {
  match update.download_and_install(|_, _| {}, || {}).await {
    Ok(()) => app.restart(),
    Err(err) => log::warn!("update install failed: {err}"),
  }
}
