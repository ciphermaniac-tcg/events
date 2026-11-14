//! Keeps the app on the event site. Links to anywhere else open in the
//! system browser, including Google sign-in, which refuses embedded webviews.

use tauri::{
  plugin::{Builder, TauriPlugin},
  AppHandle, Manager, Runtime, Url, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

const MAIN_WINDOW: &str = "main";

/// Hosts the app loads itself: the site, Clerk's sign-in, and the bot checks
/// the site and Discord show in frames (macOS asks about frames too).
const IN_APP_HOSTS: &[&str] = &[
  "events.ciphermaniac.com",
  "clerk.ciphermaniac.com",
  "challenges.cloudflare.com",
  "hcaptcha.com",
];
const IN_APP_HOST_SUFFIXES: &[&str] = &[".protect.clerk.com", ".hcaptcha.com", ".localhost"];
const LOCAL_HOSTS: &[&str] = &["localhost", "127.0.0.1"];
/// Discord sign-in works in a webview, so its OAuth pages stay in the app
/// and the session lands in the app's cookies.
const DISCORD_SIGN_IN_PATHS: &[&str] = &["/oauth2/", "/login"];

fn is_web(url: &Url) -> bool {
  matches!(url.scheme(), "http" | "https")
}

fn is_hand_off(url: &Url) -> bool {
  matches!(url.scheme(), "mailto" | "tel" | "sms")
}

fn is_in_app_host(host: &str) -> bool {
  IN_APP_HOSTS.contains(&host)
    || LOCAL_HOSTS.contains(&host)
    || IN_APP_HOST_SUFFIXES.iter().any(|suffix| host.ends_with(suffix))
}

fn is_discord_sign_in(host: &str, path: &str) -> bool {
  host == "discord.com" && DISCORD_SIGN_IN_PATHS.iter().any(|p| path.starts_with(p))
}

/// Whether a navigation loads in the app rather than the system browser.
/// Schemes the webview handles itself (about:, data:, blob:, the app's own
/// protocols) stay; mail and phone links go to the system.
fn stays_in_app(url: &Url) -> bool {
  if !is_web(url) {
    return !is_hand_off(url);
  }
  url
    .host_str()
    .is_none_or(|host| is_in_app_host(host) || is_discord_sign_in(host, url.path()))
}

fn open_outside<R: Runtime>(app: &AppHandle<R>, url: &Url) {
  if let Err(err) = app.opener().open_url(url.as_str(), None::<&str>) {
    log::warn!("could not open {url} in the system browser: {err}");
  }
}

/// Applies the link policy to every navigation in every webview.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("links")
    .on_navigation(|webview, url| {
      if stays_in_app(url) {
        return true;
      }
      open_outside(webview.app_handle(), url);
      false
    })
    .build()
}

/// Builds the main window from its tauri.conf.json entry (`create: false`)
/// so it can also catch `target="_blank"` links and `window.open` on desktop.
pub fn create_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
  let Some(config) = app
    .config()
    .app
    .windows
    .iter()
    .find(|window| window.label == MAIN_WINDOW)
  else {
    return Ok(());
  };
  let builder = WebviewWindowBuilder::from_config(app, config)?;
  #[cfg(desktop)]
  let builder = {
    let app = app.clone();
    builder.on_new_window(move |url, _features| {
      follow_new_window(&app, &url);
      tauri::webview::NewWindowResponse::Deny
    })
  };
  builder.build()?;
  Ok(())
}

/// A new-window request either loads in the main window or leaves the app.
#[cfg(desktop)]
fn follow_new_window<R: Runtime>(app: &AppHandle<R>, url: &Url) {
  if !stays_in_app(url) {
    open_outside(app, url);
    return;
  }
  if let Some(window) = app.get_webview_window(MAIN_WINDOW)
    && let Err(err) = window.navigate(url.clone())
  {
    log::warn!("could not open {url}: {err}");
  }
}

#[cfg(test)]
mod tests {
  use super::stays_in_app;
  use tauri::Url;

  fn stays(url: &str) -> bool {
    stays_in_app(&Url::parse(url).unwrap())
  }

  #[test]
  fn keeps_the_site_and_sign_in_in_the_app() {
    assert!(stays("https://events.ciphermaniac.com/host"));
    assert!(stays("https://clerk.ciphermaniac.com/v1/oauth_callback"));
    assert!(stays("https://discord.com/oauth2/authorize?client_id=1"));
    assert!(stays("https://discord.com/login?redirect_to=%2Foauth2"));
    assert!(stays("https://challenges.cloudflare.com/cdn-cgi/challenge"));
    assert!(stays("http://tauri.localhost/index.html"));
    assert!(stays("tauri://localhost/"));
    assert!(stays("about:blank"));
  }

  #[test]
  fn sends_everything_else_to_the_system() {
    assert!(!stays("https://accounts.google.com/o/oauth2/v2/auth"));
    assert!(!stays("https://discord.com/invite/abc"));
    assert!(!stays("https://ciphermaniac.com/"));
    assert!(!stays("https://limitlesstcg.com/"));
    assert!(!stays("https://events.ciphermaniac.com.evil.example/"));
    assert!(!stays("mailto:someone@example.com"));
  }
}
