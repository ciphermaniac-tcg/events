//! The menu bar: the standard menus plus the app's own commands, which act
//! on the main window. Settings, Back, Forward, Reload and the Go menu move
//! within the site as its own links do; Feedback opens the main site in the
//! browser. "TOM Link…" (`tom.rs`) sits under Settings in the Mac's app menu
//! and in the Window menu elsewhere, where File holds Settings.

use tauri::{
    AppHandle, Manager, Runtime, Url,
    menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder},
};

use crate::{shell, tom};

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
    /// A page outside the app, in the browser.
    Outside(&'static str),
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

fn settings<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::MenuItem<R>> {
    item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))
}

#[cfg(target_os = "macos")]
fn first_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "Ciphermaniac Events")
        .about(None)
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
    SubmenuBuilder::new(app, "View")
        .item(&item(app, "reload", "Reload", Some("CmdOrCtrl+R"))?)
        .separator()
        .fullscreen()
        .build()
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

#[cfg(target_os = "macos")]
fn window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()
}

#[cfg(not(target_os = "macos"))]
fn window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&tom::menu_item(app)?)
        .build()
}

/// Help, which also holds About outside the Mac.
fn help_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let menu = SubmenuBuilder::new(app, "Help")
        .item(&item(app, "feedback", "Send Feedback", None)?)
        .separator()
        .item(&item(app, "terms", "Terms", None)?)
        .item(&item(app, "privacy", "Privacy", None)?);
    #[cfg(not(target_os = "macos"))]
    let menu = menu.separator().about(None);
    menu.build()
}

/// The app's menu bar.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    MenuBuilder::new(app)
        .item(&first_menu(app)?)
        .item(&edit_menu(app)?)
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
    if let Some(action) = action_of(event.id().as_ref()) {
        run(app, action);
    }
}

#[cfg(test)]
mod tests {
    use super::{Action, action_of, follow_script};

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
}
