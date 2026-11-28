#[cfg(target_os = "android")]
mod android;
mod app_style;
mod appearance;
#[cfg(any(desktop, test))]
mod big_screen;
#[cfg(any(windows, test))]
mod context_menu;
mod data_dir;
#[cfg(windows)]
mod downloads;
mod last_page;
#[cfg(any(target_os = "macos", test))]
mod mac_controls;
#[cfg(target_os = "macos")]
mod mac_dock;
#[cfg(any(target_os = "macos", test))]
mod mac_page;
#[cfg(any(target_os = "macos", test))]
mod mac_sheets;
#[cfg(any(target_os = "macos", test))]
mod mac_title_strip;
#[cfg(desktop)]
mod menu;
#[cfg(any(windows, target_os = "linux", test))]
mod offline;
mod pending;
mod shell;
#[cfg(any(windows, test))]
mod shortcuts;
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
            data_dir::init(app.handle());
            shell::create_main_window(app.handle())?;
            #[cfg(desktop)]
            {
                tom::setup(app);
                updater::check_on_launch(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| on_run_event(app, &event));
}

/// The app's events while it runs: on the Mac, the Dock icon clicked
/// (`mac_dock.rs`).
#[cfg(target_os = "macos")]
fn on_run_event(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    mac_dock::on_run_event(app, event);
}

#[cfg(not(target_os = "macos"))]
fn on_run_event(_app: &tauri::AppHandle, _event: &tauri::RunEvent) {}

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
        shell::reveal_main_window(app);
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            theme::app_theme,
            tom::tom_state,
            tom::tom_read,
            tom::tom_turn_on,
            tom::tom_turn_off,
            tom::tom_show,
            tom::tom_retry,
            tom::tom_confirm_event,
            tom::tom_badge,
            tom::tom_submit,
            tom::tom_start_round,
            big_screen::open_big_screen,
            #[cfg(target_os = "macos")]
            mac_title_strip::title_strip_double_click,
            #[cfg(target_os = "macos")]
            mac_page::page_shown,
        ])
}

#[cfg(mobile)]
fn with_desktop(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}
