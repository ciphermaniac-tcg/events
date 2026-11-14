//! The verifier of a sign-in waiting for its link, kept on disk so it
//! outlives the app being closed while the browser has the screen (Android
//! may do that). It lives in a directory only this user can enter and a file
//! only this user can read, and neither is followed through a link someone
//! else planted. On Windows the per-user app data directory is private
//! already, so there the files take its permissions.

use std::{
    fs, io,
    path::Path,
    time::{Duration, SystemTime},
};

const VERIFIER_FILE: &str = "verifier";
/// As long as the site's sign-in state lasts in the browser.
const MAX_AGE: Duration = Duration::from_secs(10 * 60);

/// Makes `dir` this user's alone, refusing one that is a link.
fn private_dir(dir: &Path) -> io::Result<()> {
    match fs::symlink_metadata(dir) {
        Ok(meta) if meta.is_dir() => restrict_dir(dir),
        Ok(_) => Err(io::Error::other("the sign-in directory is not a directory")),
        Err(err) if err.kind() == io::ErrorKind::NotFound => create_private_dir(dir),
        Err(err) => Err(err),
    }
}

#[cfg(unix)]
fn create_private_dir(dir: &Path) -> io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::DirBuilder::new().mode(0o700).create(dir)
}

#[cfg(not(unix))]
fn create_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)
}

#[cfg(unix)]
fn restrict_dir(dir: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn restrict_dir(_dir: &Path) -> io::Result<()> {
    Ok(())
}

/// A new file only this user can read; never one that was there, link or not.
fn create_private_file(path: &Path) -> io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn remove(path: &Path) {
    if let Err(err) = fs::remove_file(path)
        && err.kind() != io::ErrorKind::NotFound
    {
        log::warn!("could not remove {}: {err}", path.display());
    }
}

/// Keeps `verifier` in `dir` for the sign-in's link, in place of any before it.
pub fn keep(dir: &Path, verifier: &str) -> io::Result<()> {
    use std::io::Write;
    private_dir(dir)?;
    let path = dir.join(VERIFIER_FILE);
    remove(&path);
    create_private_file(&path)?.write_all(verifier.as_bytes())
}

fn is_fresh(meta: &fs::Metadata) -> bool {
    meta.modified()
        .ok()
        .and_then(|at| SystemTime::now().duration_since(at).ok())
        .is_some_and(|age| age < MAX_AGE)
}

/// Takes the verifier out of `dir`, once; none when it is too old, or is a
/// link rather than the file kept.
pub fn take(dir: &Path) -> Option<String> {
    let path = dir.join(VERIFIER_FILE);
    let meta = fs::symlink_metadata(&path).ok()?;
    let verifier = (meta.is_file() && is_fresh(&meta))
        .then(|| fs::read_to_string(&path).ok())
        .flatten();
    remove(&path);
    verifier
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{keep, take};
    use std::{fs, path::PathBuf};

    /// A fresh directory of the test's own under the system's temporary one.
    pub fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cm-sign-in-{name}-{}", std::process::id()));
        if let Err(err) = fs::remove_dir_all(&dir) {
            assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
        }
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn keeps_a_verifier_once() {
        let dir = scratch("once").join("sign-in");
        keep(&dir, "first").unwrap();
        keep(&dir, "second").unwrap();
        assert_eq!(take(&dir).as_deref(), Some("second"));
        assert_eq!(take(&dir), None);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_it_where_only_this_user_can_read_it() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("private");
        let made = root.join("made");
        keep(&made, "secret").unwrap();
        let permissions_of =
            |path: PathBuf| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(permissions_of(made.clone()), 0o700);
        assert_eq!(permissions_of(made.join("verifier")), 0o600);
        let open = root.join("open");
        fs::create_dir(&open).unwrap();
        fs::set_permissions(&open, fs::Permissions::from_mode(0o755)).unwrap();
        keep(&open, "secret").unwrap();
        assert_eq!(
            permissions_of(open),
            0o700,
            "a directory already there is closed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn follows_no_planted_link() {
        use std::os::unix::fs::symlink;
        let root = scratch("links");
        let elsewhere = root.join("elsewhere");
        fs::write(&elsewhere, "untouched").unwrap();
        let dir = root.join("sign-in");
        fs::create_dir(&dir).unwrap();
        symlink(&elsewhere, dir.join("verifier")).unwrap();
        assert_eq!(take(&dir), None, "a linked file is not read");
        symlink(&elsewhere, dir.join("verifier")).unwrap();
        keep(&dir, "secret").unwrap();
        assert_eq!(fs::read_to_string(&elsewhere).unwrap(), "untouched");
        let linked_dir = root.join("linked");
        symlink(&dir, &linked_dir).unwrap();
        assert!(
            keep(&linked_dir, "secret").is_err(),
            "a linked directory is refused"
        );
    }
}
