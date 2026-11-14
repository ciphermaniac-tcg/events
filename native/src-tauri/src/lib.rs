mod shell;
mod sign_in;
#[cfg(desktop)]
mod tom;
#[cfg(desktop)]
mod updater;

/// Starts the app.
///
/// # Panics
/// When Tauri cannot start, which leaves nothing to show.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = with_single_instance(tauri::Builder::default())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(shell::init())
        .plugin(sign_in::init());
    with_desktop(builder)
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
            {
                tom::setup(app)?;
                updater::check_on_launch(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

/// One app at a time on desktop: opening a sign-in link or the app again
/// brings the running one forward and hands it the link. It must be the
/// first plugin.
#[cfg(desktop)]
fn with_single_instance(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window(shell::MAIN_WINDOW)
            && let Err(err) = window.set_focus()
        {
            log::debug!("could not bring the app forward: {err}");
        }
    }))
}

#[cfg(mobile)]
fn with_single_instance(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

#[cfg(desktop)]
fn with_desktop(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Keeps the .tdf picked in the panel readable after a restart.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            tom::tom_detect,
            tom::tom_set_path,
            tom::tom_launch,
            tom::tom_status,
            tom::tom_submit,
            tom::tom_save,
            tom::tom_start_round,
            tom::tom_open_panel,
        ])
}

#[cfg(mobile)]
fn with_desktop(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}
