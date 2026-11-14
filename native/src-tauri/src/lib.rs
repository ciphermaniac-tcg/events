mod shell;
#[cfg(desktop)]
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(shell::init());
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_updater::Builder::new().build());
  builder
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      shell::create_main_window(app.handle())?;
      #[cfg(desktop)]
      updater::check_on_launch(app.handle());
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
