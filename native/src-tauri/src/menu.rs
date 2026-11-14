//! The menu bar: the standard menus plus the app's own commands, which act
//! on the main window. Settings, Back, Forward, Reload and the Go menu move
//! within the site as its own links do; the zoom commands scale the page;
//! View > Appearance picks light or dark (`appearance.rs`); Feedback opens
//! the main site in the browser. "TOM Link…" (`tom.rs`) sits under Settings
//! in the Mac's app menu and in the Window menu elsewhere, where File holds
//! Settings. On the Mac the menus are the system's own: File holds Close
//! Window, View ends with Enter Full Screen, and Window and Help are the
//! app's windows and help menus to the system, which lists the open windows
//! in Window.

use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::{
    AppHandle, Manager, Runtime, Url,
    menu::{
        AboutMetadata, HELP_SUBMENU_ID, Menu, MenuBuilder, MenuEvent, MenuItemBuilder,
        SubmenuBuilder, WINDOW_SUBMENU_ID,
    },
};

use crate::{appearance, shell, tom};

/// An app command: its menu id and what it does.
struct Command {
    id: &'static str,
    action: Action,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    /// A page of the site, by path.
    Page(&'static str),
    Back,
    Forward,
    Reload,
    Zoom(Zoom),
    /// A page outside the app, in the browser.
    Outside(&'static str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Zoom {
    In,
    Out,
    Reset,
}

/// The page's zoom levels, as a browser steps through them.
const ZOOM_LEVELS: &[f64] = &[0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
const ACTUAL_SIZE: usize = 5;

/// The main window's zoom, as an index into `ZOOM_LEVELS`.
static ZOOM_LEVEL: AtomicUsize = AtomicUsize::new(ACTUAL_SIZE);

/// The level a zoom command goes to from `level`, staying within the range.
fn zoomed(level: usize, zoom: Zoom) -> usize {
    match zoom {
        Zoom::In => (level + 1).min(ZOOM_LEVELS.len() - 1),
        Zoom::Out => level.saturating_sub(1),
        Zoom::Reset => ACTUAL_SIZE,
    }
}

const COMMANDS: &[Command] = &[
    Command {
        id: "settings",
        action: Action::Page("/settings"),
    },
    Command {
        id: "back",
        action: Action::Back,
    },
    Command {
        id: "forward",
        action: Action::Forward,
    },
    Command {
        id: "reload",
        action: Action::Reload,
    },
    Command {
        id: "zoom_in",
        action: Action::Zoom(Zoom::In),
    },
    Command {
        id: "zoom_out",
        action: Action::Zoom(Zoom::Out),
    },
    Command {
        id: "actual_size",
        action: Action::Zoom(Zoom::Reset),
    },
    Command {
        id: "home",
        action: Action::Page("/"),
    },
    Command {
        id: "history",
        action: Action::Page("/history"),
    },
    Command {
        id: "terms",
        action: Action::Page("/terms"),
    },
    Command {
        id: "privacy",
        action: Action::Page("/privacy"),
    },
    Command {
        id: "feedback",
        action: Action::Outside("https://ciphermaniac.com/feedback"),
    },
];

fn action_of(id: &str) -> Option<Action> {
    COMMANDS
        .iter()
        .find(|command| command.id == id)
        .map(|command| command.action)
}

/// Follows `path` the way a link on the page would, so the site moves
/// without loading again.
fn follow_script(path: &str) -> String {
    let path = serde_json::Value::from(path);
    format!(
        "(() => {{ const link = document.createElement('a'); link.href = {path}; \
         link.hidden = true; document.body.append(link); link.click(); link.remove(); }})();"
    )
}

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    shortcut: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let builder = MenuItemBuilder::with_id(id, text);
    match shortcut {
        Some(keys) => builder.accelerator(keys),
        None => builder,
    }
    .build(app)
}

/// History's shortcut: Safari's on the Mac; elsewhere Ctrl+Y is Redo.
const HISTORY_KEYS: &str = if cfg!(target_os = "macos") {
    "Cmd+Y"
} else {
    "Ctrl+H"
};

/// What About shows: the version, and the copyright kept in the bundle's
/// config. The Mac's panel also shows a build number in parentheses, the
/// same as the version here, so it gets an empty one, which leaves it out;
/// elsewhere an empty one would print as "()".
fn about<R: Runtime>(app: &AppHandle<R>) -> AboutMetadata<'static> {
    AboutMetadata {
        version: Some(app.package_info().version.to_string()),
        short_version: cfg!(target_os = "macos").then(String::new),
        copyright: app.config().bundle.copyright.clone(),
        ..AboutMetadata::default()
    }
}

fn settings<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::MenuItem<R>> {
    item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))
}

#[cfg(target_os = "macos")]
fn first_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "Ciphermaniac Events")
        .about(Some(about(app)))
        .separator()
        .item(&settings(app)?)
        .item(&tom::menu_item(app)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
}

/// File, holding what the window has: Close Window (Cmd+W).
#[cfg(target_os = "macos")]
fn file_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "File").close_window().build()
}

#[cfg(not(target_os = "macos"))]
fn first_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let menu = SubmenuBuilder::new(app, "File").item(&settings(app)?);
    // GTK shows Close Window and Quit only as dead, greyed-out items.
    #[cfg(windows)]
    let menu = menu.separator().close_window().quit();
    menu.build()
}

fn edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()
}

fn view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let menu = SubmenuBuilder::new(app, "View")
        .item(&item(app, "reload", "Reload", Some("CmdOrCtrl+R"))?)
        .separator()
        .item(&item(
            app,
            "actual_size",
            "Actual Size",
            Some("CmdOrCtrl+0"),
        )?)
        .item(&item(app, "zoom_in", "Zoom In", Some("CmdOrCtrl+="))?)
        .item(&item(app, "zoom_out", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .separator()
        .item(&appearance::submenu(app)?)
        .separator();
    // The system's own item, whose title AppKit turns to Exit Full Screen.
    #[cfg(target_os = "macos")]
    let menu = menu.fullscreen_with_text("Enter Full Screen");
    #[cfg(not(target_os = "macos"))]
    let menu = menu.fullscreen();
    menu.build()
}

fn go_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "Go")
        .item(&item(app, "back", "Back", Some("CmdOrCtrl+["))?)
        .item(&item(app, "forward", "Forward", Some("CmdOrCtrl+]"))?)
        .separator()
        .item(&item(app, "home", "Home", Some("CmdOrCtrl+Shift+H"))?)
        .item(&item(app, "history", "History", Some(HISTORY_KEYS))?)
        .build()
}

/// The system's Window menu: Minimize, Zoom, Bring All to Front, and the
/// open windows, which the system lists under them.
#[cfg(target_os = "macos")]
fn window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()
}

#[cfg(not(target_os = "macos"))]
fn window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&tom::menu_item(app)?)
        .build()
}

/// Help, which also holds About outside the Mac.
fn help_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let menu = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help")
        .item(&item(app, "feedback", "Send Feedback", None)?)
        .separator()
        .item(&item(app, "terms", "Terms", None)?)
        .item(&item(app, "privacy", "Privacy", None)?);
    #[cfg(not(target_os = "macos"))]
    let menu = menu.separator().about(Some(about(app)));
    menu.build()
}

/// The app's menu bar.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = MenuBuilder::new(app).item(&first_menu(app)?);
    #[cfg(target_os = "macos")]
    let menu = menu.item(&file_menu(app)?);
    menu.item(&edit_menu(app)?)
        .item(&view_menu(app)?)
        .item(&go_menu(app)?)
        .item(&window_menu(app)?)
        .item(&help_menu(app)?)
        .build()
}

/// Runs a page change in the main window: in the page when it is the
/// site's, else by loading that page of the site.
fn go_to<R: Runtime>(app: &AppHandle<R>, path: &str) {
    let Some(window) = app.get_webview_window(shell::MAIN_WINDOW) else {
        return;
    };
    let on_site = window
        .url()
        .is_ok_and(|url| url.host_str().is_some_and(shell::is_site_host));
    let done = if on_site {
        window.eval(follow_script(path))
    } else if let Some(page) = shell::home_url(app).and_then(|home| home.join(path).ok()) {
        window.navigate(page)
    } else {
        Ok(())
    };
    if let Err(err) = done {
        log::warn!("could not open {path}: {err}");
    }
}

fn run<R: Runtime>(app: &AppHandle<R>, action: Action) {
    let Some(window) = app.get_webview_window(shell::MAIN_WINDOW) else {
        return;
    };
    let done = match action {
        Action::Page(path) => {
            go_to(app, path);
            Ok(())
        }
        Action::Back => window.eval("history.back()"),
        Action::Forward => window.eval("history.forward()"),
        Action::Reload => window.reload(),
        Action::Zoom(zoom) => {
            let level = zoomed(ZOOM_LEVEL.load(Ordering::Relaxed), zoom);
            ZOOM_LEVEL.store(level, Ordering::Relaxed);
            window.set_zoom(ZOOM_LEVELS[level])
        }
        Action::Outside(page) => {
            if let Ok(url) = Url::parse(page) {
                shell::open_outside(app, &url);
            }
            Ok(())
        }
    };
    if let Err(err) = done {
        log::warn!("could not run the menu command: {err}");
    }
}

/// Runs the app's own menu commands; the standard ones run themselves.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    let id = event.id().as_ref();
    if appearance::on_menu_event(app, id) {
        return;
    }
    if let Some(action) = action_of(id) {
        run(app, action);
    }
}

#[cfg(test)]
mod tests {
    use super::{ACTUAL_SIZE, Action, ZOOM_LEVELS, Zoom, action_of, follow_script, zoomed};

    #[test]
    fn maps_each_command_to_what_it_does() {
        assert_eq!(action_of("settings"), Some(Action::Page("/settings")));
        assert_eq!(action_of("back"), Some(Action::Back));
        assert_eq!(action_of("reload"), Some(Action::Reload));
        assert_eq!(
            action_of("feedback"),
            Some(Action::Outside("https://ciphermaniac.com/feedback"))
        );
        assert_eq!(action_of("quit"), None, "the standard items run themselves");
    }

    #[test]
    fn follows_a_path_as_a_link_on_the_page() {
        let script = follow_script("/settings");
        assert!(script.contains(r#"link.href = "/settings""#));
        assert!(script.contains("link.click()"));
    }

    #[test]
    fn zooms_a_step_at_a_time_within_the_range() {
        assert!((ZOOM_LEVELS[ACTUAL_SIZE] - 1.0).abs() < f64::EPSILON);
        assert_eq!(zoomed(ACTUAL_SIZE, Zoom::In), ACTUAL_SIZE + 1);
        assert_eq!(zoomed(ACTUAL_SIZE, Zoom::Out), ACTUAL_SIZE - 1);
        let largest = ZOOM_LEVELS.len() - 1;
        assert_eq!(zoomed(largest, Zoom::In), largest);
        assert_eq!(zoomed(0, Zoom::Out), 0);
        assert_eq!(zoomed(largest, Zoom::Reset), ACTUAL_SIZE);
        assert_eq!(action_of("zoom_in"), Some(Action::Zoom(Zoom::In)));
    }
}
