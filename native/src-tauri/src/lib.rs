#[cfg(desktop)]
mod app_style;
#[cfg(any(windows, test))]
mod context_menu;
mod last_page;
#[cfg(desktop)]
mod menu;
mod pending;
mod shell;
mod sign_in;
#[cfg(desktop)]
mod theme;
#[cfg(windows)]
mod title_bar;
#[cfg(desktop)]
mod tom;
#[cfg(desktop)]
mod updater;
#[cfg(windows)]
mod webview2;

/// Starts the app.
///
/// # Panics
/// When Tauri cannot start, which leaves nothing to show.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = with_desktop_shell(tauri::Builder::default())
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
                tom::setup(app);
                updater::check_on_launch(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

/// What a desktop app has: one running at a time (opening a sign-in link or
/// the app again brings the running one forward and hands it the link, so
/// it must be the first plugin), windows that open where they were left,
/// and the app's own menu bar.
#[cfg(desktop)]
fn with_desktop_shell(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    use tauri_plugin_window_state::StateFlags;
    with_single_instance(builder)
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE - StateFlags::DECORATIONS)
                .build(),
        )
        .menu(menu::build)
        .on_menu_event(|app, event| menu::on_event(app, &event))
}

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
fn with_desktop_shell(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
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
            theme::app_theme,
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
