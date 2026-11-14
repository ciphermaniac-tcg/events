//! Opens the main window where it was left: the last page of the site that
//! finished loading, kept in the app's data directory.

use std::{fs, path::PathBuf};

use tauri::{AppHandle, Runtime, Url};

use crate::{data_dir, shell};

const LAST_PAGE_FILE: &str = "last-page";

/// Pages not worth coming back to: the site's API, and the age check in the
/// middle of signing up.
const SKIPPED_PREFIXES: &[&str] = &["/api/", "/welcome"];

/// Whether a page of the site is one to reopen at the next launch.
fn worth_reopening(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(shell::is_site_host)
        && !SKIPPED_PREFIXES
            .iter()
            .any(|prefix| url.path().starts_with(prefix))
}

fn last_page_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    data_dir::get(app).map(|dir| dir.join(LAST_PAGE_FILE))
}

/// Keeps `url` as the page to reopen, when it is one.
pub fn remember<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if !worth_reopening(url) {
        return;
    }
    let Some(path) = last_page_path(app) else {
        return;
    };
    let written = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(&path, url.as_str()));
    if let Err(err) = written {
        log::debug!("could not keep the last page: {err}");
    }
}

/// The page to reopen, when one was kept and still is one.
pub fn restore<R: Runtime>(app: &AppHandle<R>) -> Option<Url> {
    let kept = fs::read_to_string(last_page_path(app)?).ok()?;
    Url::parse(kept.trim()).ok().filter(worth_reopening)
}

#[cfg(test)]
mod tests {
    use super::worth_reopening;
    use tauri::Url;

    fn reopens(url: &str) -> bool {
        worth_reopening(&Url::parse(url).unwrap())
    }

    #[test]
    fn reopens_pages_of_the_site_only() {
        assert!(reopens(
            "https://events.ciphermaniac.com/host/ABCD?tab=pairings"
        ));
        assert!(reopens("https://events.ciphermaniac.com/settings"));
        assert!(!reopens("https://events.ciphermaniac.com/api/auth/redeem"));
        assert!(!reopens("https://events.ciphermaniac.com/welcome?next=%2F"));
        assert!(!reopens("https://discord.com/oauth2/authorize"));
        assert!(!reopens("http://events.ciphermaniac.com/"));
        assert!(!reopens("about:blank"));
    }
}
