//! An event's big screen (`/t/<code>?screen=1`) opens in a window of its
//! own, as the site opens it in a tab of its own: the console stays where it
//! was, and the screen can go to a projector and full screen there (the
//! window-state plugin remembers where). A second one replaces the first.
//!
//! The site's Big screen links open a new tab (`target="_blank"`). A plain
//! click or Return on one is claimed by the page script and asked of the app
//! (`open_big_screen`), so the window is made the way the app's other
//! windows are, outside the webview's own new-window callback: on the Mac
//! that callback opened nothing. A request that still arrives through the
//! callback (Cmd-click, `window.open`) is opened after it returns.

use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder};

use crate::shell;

/// The big screen's own window.
const SCREEN_WINDOW: &str = "screen";

/// Whether `url` is an event's big screen on the site; its stream view
/// (`&stream`) is not.
pub fn is_big_screen(url: &Url) -> bool {
    url.host_str().is_some_and(shell::is_site_host)
        && url.path().starts_with("/t/")
        && url
            .query_pairs()
            .any(|(key, value)| key == "screen" && value == "1")
        && !url.query_pairs().any(|(key, _)| key == "stream")
}

/// The big screen a page asked for, when it is one.
fn screen_url(asked: &str) -> Option<Url> {
    Url::parse(asked).ok().filter(is_big_screen)
}

fn open<R: Runtime>(app: &AppHandle<R>, url: &Url) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SCREEN_WINDOW) {
        window.navigate(url.clone())?;
        return window.set_focus();
    }
    let builder = WebviewWindowBuilder::new(app, SCREEN_WINDOW, WebviewUrl::External(url.clone()))
        .title("Big Screen")
        .inner_size(1280.0, 720.0)
        .min_inner_size(640.0, 360.0)
        .initialization_script(crate::app_style::script());
    #[cfg(target_os = "macos")]
    let builder = builder.allow_link_preview(false);
    builder.build().map(drop)
}

/// Opens the big screen once the webview's new-window callback has
/// returned, from a thread of its own as a command would.
pub fn open_later<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    let app = app.clone();
    let url = url.clone();
    std::thread::spawn(move || {
        if let Err(err) = open(&app, &url) {
            log::warn!("could not open the big screen: {err}");
        }
    });
}

/// Opens the big screen a page's link asked for; anything else is refused.
#[tauri::command]
pub async fn open_big_screen<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    let url = screen_url(&url).ok_or("not a big screen")?;
    open(&app, &url).map_err(|err| err.to_string())
}

/// The script each page of the main window runs first: a plain click (or
/// Return) on a link to a big screen in a new tab asks the app instead.
pub fn script() -> String {
    let site = shell::SITE_HOST;
    format!(
        "(() => {{ if (location.hostname !== '{site}') return; \
         document.addEventListener('click', event => {{ \
         if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey \
         || event.shiftKey || event.altKey) return; \
         const link = event.target instanceof Element ? event.target.closest('a[target=\"_blank\"][href]') : null; \
         if (!link) return; const url = new URL(link.href); \
         if (url.hostname !== location.hostname || !url.pathname.startsWith('/t/') \
         || url.searchParams.get('screen') !== '1' || url.searchParams.has('stream')) return; \
         event.preventDefault(); \
         window.__TAURI_INTERNALS__.invoke('open_big_screen', {{ url: url.href }}).catch(() => {{}}); \
         }}, true); }})();"
    )
}

#[cfg(test)]
mod tests {
    use super::{is_big_screen, screen_url, script};
    use tauri::Url;

    #[test]
    fn knows_an_events_big_screen() {
        let screen = |url: &str| is_big_screen(&Url::parse(url).unwrap());
        assert!(screen("https://events.ciphermaniac.com/t/ABC123?screen=1"));
        assert!(!screen(
            "https://events.ciphermaniac.com/t/ABC123?screen=1&stream=1"
        ));
        assert!(!screen("https://events.ciphermaniac.com/t/ABC123"));
        assert!(!screen("https://events.ciphermaniac.com/host?screen=1"));
        assert!(!screen("https://example.com/t/ABC123?screen=1"));
    }

    #[test]
    fn opens_only_a_big_screen_a_page_asks_for() {
        assert!(screen_url("https://events.ciphermaniac.com/t/MSFMQ9?screen=1").is_some());
        assert!(screen_url("https://example.com/t/MSFMQ9?screen=1").is_none());
        assert!(screen_url("file:///etc/passwd").is_none());
        assert!(screen_url("not a url").is_none());
    }

    #[test]
    fn claims_a_plain_click_on_a_big_screen_link() {
        let script = script();
        assert!(script.contains("closest('a[target=\"_blank\"][href]')"));
        assert!(script.contains("url.searchParams.get('screen') !== '1'"));
        assert!(
            script.contains("event.metaKey"),
            "a Cmd-click is left alone"
        );
        assert!(script.contains("invoke('open_big_screen', { url: url.href })"));
        assert!(script.contains("}, true);"), "ahead of the site's router");
    }
}
