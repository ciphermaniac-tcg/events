//! The window's own colors, kept with the site's: the page color behind the
//! site, so a slow start or a reload shows the page's color rather than
//! white. They start from the system's mode, before the window shows.

use tauri::{Runtime, Theme, WebviewWindow, window::Color};

/// The site's page color in each mode (`--bg` in the design package's
/// tokens.css).
const LIGHT_PAGE: Color = Color(0xec, 0xec, 0xea, 0xff);
const DARK_PAGE: Color = Color(0x16, 0x16, 0x15, 0xff);

fn page_color(dark: bool) -> Color {
    if dark { DARK_PAGE } else { LIGHT_PAGE }
}

/// Paints the window for a mode. On Linux only the webview takes the color,
/// since the window's own would recolor GTK's menu bar; on macOS only the
/// window does, as Tauri doesn't color the webview there.
pub fn paint<R: Runtime>(window: &WebviewWindow<R>, dark: bool) {
    let color = Some(page_color(dark));
    #[cfg(target_os = "linux")]
    let painted = AsRef::<tauri::Webview<R>>::as_ref(window).set_background_color(color);
    #[cfg(not(target_os = "linux"))]
    let painted = window.set_background_color(color);
    if let Err(err) = painted {
        log::debug!("could not color the window: {err}");
    }
}

/// Paints a new window for the system's mode.
pub fn paint_for_system<R: Runtime>(window: &WebviewWindow<R>) {
    paint(
        window,
        window.theme().is_ok_and(|theme| theme == Theme::Dark),
    );
}

#[cfg(test)]
mod tests {
    use super::page_color;
    use tauri::window::Color;

    #[test]
    fn paints_the_sites_page_color_for_each_mode() {
        assert_eq!(page_color(false), Color(0xec, 0xec, 0xea, 0xff));
        assert_eq!(page_color(true), Color(0x16, 0x16, 0x15, 0xff));
    }
}
