//! The window's own colors, kept with the site's: the page color behind the
//! site, so a slow start or a reload shows the page's color rather than
//! white, and on Windows 11 the title bar in the head bar's color
//! (`title_bar.rs`). They start from the system's mode, before the window
//! shows, then follow the mode the site reports through `app_theme`.

use tauri::{Runtime, Theme, WebviewWindow, window::Color};

use crate::shell;

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
    #[cfg(windows)]
    crate::title_bar::paint(window, dark);
}

/// Takes the site's mode, as `script` reports it.
#[tauri::command]
pub async fn app_theme<R: Runtime>(window: WebviewWindow<R>, dark: bool) {
    if window.label() == shell::MAIN_WINDOW {
        paint(&window, dark);
    }
}

/// The script each page of the main window runs first: it reports the
/// site's mode whenever it changes. The home page is dark in either mode;
/// elsewhere `body[data-mode]` holds the mode, else the system's applies.
pub fn script() -> String {
    let site = shell::SITE_HOST;
    format!(
        "(() => {{ if (location.hostname !== '{site}') return; \
         const system = matchMedia('(prefers-color-scheme: dark)'); let last; \
         const report = () => {{ const body = document.body; const mode = body.dataset.mode; \
         const dark = body.classList.contains('tm-home-mode') || (mode ? mode === 'dark' : system.matches); \
         if (dark === last) return; last = dark; \
         window.__TAURI_INTERNALS__.invoke('app_theme', {{ dark }}).catch(() => {{}}); }}; \
         const start = () => {{ report(); system.addEventListener('change', report); \
         new MutationObserver(report).observe(document.body, \
         {{ attributes: true, attributeFilter: ['data-mode', 'class'] }}); }}; \
         if (document.readyState === 'loading') {{ \
         document.addEventListener('DOMContentLoaded', start, {{ once: true }}); }} else {{ start(); }} }})();"
    )
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
    use super::{page_color, script};
    use tauri::window::Color;

    #[test]
    fn paints_the_sites_page_color_for_each_mode() {
        assert_eq!(page_color(false), Color(0xec, 0xec, 0xea, 0xff));
        assert_eq!(page_color(true), Color(0x16, 0x16, 0x15, 0xff));
    }

    #[test]
    fn reports_the_mode_only_from_the_sites_own_pages() {
        let script = script();
        assert!(script.contains("location.hostname !== 'events.ciphermaniac.com'"));
        assert!(script.contains("invoke('app_theme', { dark })"));
        assert!(script.contains("attributeFilter: ['data-mode', 'class']"));
    }
}
