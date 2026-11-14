//! The verifiers of sign-ins waiting for their links, one file per attempt
//! named by the attempt's id, kept on disk so they outlive the app being
//! closed while the browser has the screen (Android may do that). A link
//! spends only the verifier of the attempt it names, so a stray link or a
//! second attempt leaves the others waiting. It lives in a directory only this user can enter and a file
//! only this user can read, and neither is followed through a link someone
//! else planted. On Windows the per-user app data directory is private
//! already, so there the files take its permissions.

use std::{
    fs, io,
    path::Path,
    time::{Duration, SystemTime},
};

/// An attempt's id: 16 random bytes in hex.
const ATTEMPT_LENGTH: usize = 32;
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

/// Whether `attempt` is an attempt id, which also keeps it a plain file name.
pub fn is_attempt(attempt: &str) -> bool {
    attempt.len() == ATTEMPT_LENGTH
        && attempt
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_fresh(meta: &fs::Metadata) -> bool {
    meta.modified()
        .ok()
        .and_then(|at| SystemTime::now().duration_since(at).ok())
        .is_some_and(|age| age < MAX_AGE)
}

/// Removes the attempts that ran out.
fn sweep(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry
            .metadata()
            .is_ok_and(|meta| meta.is_file() && is_fresh(&meta))
        {
            remove(&entry.path());
        }
    }
}

/// Keeps `verifier` in `dir` for the link of `attempt`.
pub fn keep(dir: &Path, attempt: &str, verifier: &str) -> io::Result<()> {
    use std::io::Write;
    if !is_attempt(attempt) {
        return Err(io::Error::other("not an attempt id"));
    }
    private_dir(dir)?;
    sweep(dir);
    let path = dir.join(attempt);
    remove(&path);
    create_private_file(&path)?.write_all(verifier.as_bytes())
}

/// The verifier of `attempt` in `dir`, left there; none when there is none,
/// it is too old, or it is a link rather than the file kept.
pub fn peek(dir: &Path, attempt: &str) -> Option<String> {
    if !is_attempt(attempt) {
        return None;
    }
    let path = dir.join(attempt);
    let meta = fs::symlink_metadata(&path).ok()?;
    (meta.is_file() && is_fresh(&meta))
        .then(|| fs::read_to_string(&path).ok())
        .flatten()
}

/// Takes the verifier of `attempt` out of `dir`, once, as `peek` finds it.
pub fn take(dir: &Path, attempt: &str) -> Option<String> {
    let verifier = peek(dir, attempt);
    if is_attempt(attempt) {
        remove(&dir.join(attempt));
    }
    verifier
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{is_attempt, keep, peek, take};
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

    const FIRST: &str = "0123456789abcdef0123456789abcdef";
    const SECOND: &str = "fedcba9876543210fedcba9876543210";

    #[test]
    fn keeps_a_verifier_once() {
        let dir = scratch("once").join("sign-in");
        keep(&dir, FIRST, "first").unwrap();
        assert_eq!(take(&dir, FIRST).as_deref(), Some("first"));
        assert_eq!(take(&dir, FIRST), None);
    }

    #[test]
    fn a_look_leaves_the_attempt_waiting() {
        let dir = scratch("peek").join("sign-in");
        keep(&dir, FIRST, "first").unwrap();
        assert_eq!(peek(&dir, FIRST).as_deref(), Some("first"));
        assert_eq!(peek(&dir, SECOND), None);
        assert_eq!(take(&dir, FIRST).as_deref(), Some("first"));
        assert_eq!(peek(&dir, FIRST), None);
    }

    #[test]
    fn a_link_spends_only_the_attempt_it_names() {
        let dir = scratch("attempts").join("sign-in");
        keep(&dir, FIRST, "first").unwrap();
        keep(&dir, SECOND, "second").unwrap();
        assert_eq!(
            take(&dir, "00000000000000000000000000000000"),
            None,
            "a stray link"
        );
        assert_eq!(take(&dir, SECOND).as_deref(), Some("second"));
        assert_eq!(
            take(&dir, FIRST).as_deref(),
            Some("first"),
            "the overlapping attempt still waits"
        );
    }

    #[test]
    fn names_only_attempt_ids() {
        assert!(is_attempt(FIRST));
        assert!(!is_attempt("../../../../etc/passwd/../../../x"));
        assert!(!is_attempt("0123456789ABCDEF0123456789ABCDEF"));
        assert!(!is_attempt("0123"));
        let dir = scratch("names").join("sign-in");
        assert!(keep(&dir, "../escape", "secret").is_err());
        assert_eq!(take(&dir, "../escape"), None);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_it_where_only_this_user_can_read_it() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("private");
        let made = root.join("made");
        keep(&made, FIRST, "secret").unwrap();
        let permissions_of =
            |path: PathBuf| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(permissions_of(made.clone()), 0o700);
        assert_eq!(permissions_of(made.join(FIRST)), 0o600);
        let open = root.join("open");
        fs::create_dir(&open).unwrap();
        fs::set_permissions(&open, fs::Permissions::from_mode(0o755)).unwrap();
        keep(&open, FIRST, "secret").unwrap();
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
        symlink(&elsewhere, dir.join(FIRST)).unwrap();
        assert_eq!(take(&dir, FIRST), None, "a linked file is not read");
        symlink(&elsewhere, dir.join(FIRST)).unwrap();
        keep(&dir, FIRST, "secret").unwrap();
        assert_eq!(fs::read_to_string(&elsewhere).unwrap(), "untouched");
        let linked_dir = root.join("linked");
        symlink(&dir, &linked_dir).unwrap();
        assert!(
            keep(&linked_dir, FIRST, "secret").is_err(),
            "a linked directory is refused"
        );
    }
}
