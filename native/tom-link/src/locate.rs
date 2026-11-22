//! Finds TOM's launcher: the program inside a macOS `.app` bundle, or the
//! `.exe` of a Windows jpackage install.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const FULL_NAME: &str = "Tournament Operations Manager";
const SHORT_NAME: &str = "TOM";

/// Launchers found in the usual install folders, best guess first.
#[must_use]
pub fn detect() -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    roots()
        .iter()
        .flat_map(|root| scan(root))
        .filter(|program| seen.insert(program.clone()))
        .collect()
}

/// Turns a user's pick (an `.app`, an install folder, or the program itself)
/// into the program to run.
///
/// # Errors
/// When the path holds no TOM launcher, or is a file not named like TOM.
pub fn resolve(path: &Path) -> Result<PathBuf, String> {
    if path.is_file() {
        let app = bundle_of(path);
        let named = app.as_deref().unwrap_or(path).file_name();
        return if named.is_some_and(|name| names_tom(&name.to_string_lossy())) {
            Ok(path.to_path_buf())
        } else {
            Err(format!("{} is not a TOM program.", path.display()))
        };
    }
    if !path.is_dir() {
        return Err(format!("{} does not exist.", path.display()));
    }
    let program = if path.extension().is_some_and(|ext| ext == "app") {
        bundle_program(path)
    } else {
        folder_program(path)
    };
    program.ok_or_else(|| format!("No TOM program was found in {}.", path.display()))
}

/// The `.app` a macOS launcher lives in (`X.app/Contents/MacOS/X`), so it
/// can be opened through `LaunchServices` instead of exec'd.
pub(crate) fn bundle_of(program: &Path) -> Option<PathBuf> {
    let macos = program
        .parent()
        .filter(|dir| dir.ends_with("Contents/MacOS"))?;
    let app = macos.parent()?.parent()?;
    app.extension()
        .is_some_and(|ext| ext == "app")
        .then(|| app.to_path_buf())
}

fn roots() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let mut out: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        out.push(PathBuf::from("/Applications"));
        out.extend(home.map(|home| home.join("Applications")));
    }
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            out.extend(std::env::var_os(var).map(PathBuf::from));
        }
        out.extend(
            local
                .iter()
                .flat_map(|local| [local.clone(), local.join("Programs")]),
        );
    }
    out
}

/// Entries of one folder that look like a TOM install, resolved to programs.
pub(crate) fn scan(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found: Vec<(bool, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            names_tom(&name).then(|| (name.contains(FULL_NAME), entry.path()))
        })
        .filter(|(_, path)| path.is_dir())
        .filter_map(|(full, path)| resolve(&path).ok().map(|program| (full, program)))
        .collect();
    // Full-name installs first, then alphabetical so results are stable.
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    found.into_iter().map(|(_, program)| program).collect()
}

/// `X.app/Contents/MacOS/X`, or the only program in that folder.
fn bundle_program(app: &Path) -> Option<PathBuf> {
    let macos = app.join("Contents").join("MacOS");
    let named = app.file_stem().map(|stem| macos.join(stem));
    named
        .filter(|path| path.is_file())
        .or_else(|| only(files(&macos, |_| true)))
}

/// `Folder/Folder.exe`, or the only `.exe` naming TOM in that folder.
fn folder_program(dir: &Path) -> Option<PathBuf> {
    let named = dir
        .file_name()
        .map(|name| dir.join(format!("{}.exe", name.to_string_lossy())));
    named.filter(|path| path.is_file()).or_else(|| {
        only(files(dir, |name| {
            let exe = Path::new(name)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
            exe && names_tom(name)
        }))
    })
}

fn names_tom(name: &str) -> bool {
    name.contains(FULL_NAME) || name.contains(SHORT_NAME)
}

fn files(dir: &Path, keep: impl Fn(&str) -> bool) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.file_name()
                .is_some_and(|name| keep(&name.to_string_lossy()))
        })
        .collect()
}

fn only(mut paths: Vec<PathBuf>) -> Option<PathBuf> {
    if paths.len() == 1 { paths.pop() } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TestDir;

    #[test]
    fn finds_a_macos_bundle_program() {
        let dir = TestDir::new();
        let program = dir.file(&format!("{FULL_NAME}.app/Contents/MacOS/{FULL_NAME}"));
        dir.file("Other.app/Contents/MacOS/Other");
        assert_eq!(scan(dir.path()), vec![program.clone()]);
        assert_eq!(
            resolve(&dir.path().join(format!("{FULL_NAME}.app"))),
            Ok(program)
        );
    }

    #[test]
    fn finds_the_app_a_launcher_belongs_to() {
        let app = Path::new("/Applications/Tournament Operations Manager.app");
        let program = app.join("Contents/MacOS/Tournament Operations Manager");
        assert_eq!(bundle_of(&program), Some(app.to_path_buf()));
        assert_eq!(bundle_of(Path::new("/opt/tom/launcher")), None);
        assert_eq!(
            bundle_of(Path::new("/Applications/X.app/Contents/Resources/x")),
            None
        );
    }

    #[test]
    fn takes_the_only_program_of_an_oddly_named_bundle() {
        let dir = TestDir::new();
        let program = dir.file("TOM 1.86.app/Contents/MacOS/launcher");
        assert_eq!(scan(dir.path()), vec![program]);
    }

    #[test]
    fn finds_a_windows_install_and_prefers_the_full_name() {
        let dir = TestDir::new();
        let full = dir.file(&format!("{FULL_NAME}/{FULL_NAME}.exe"));
        dir.file(&format!("{FULL_NAME}/app/tom.jar"));
        let short = dir.file("TOM/TOM.exe");
        assert_eq!(scan(dir.path()), vec![full, short]);
    }

    #[test]
    fn ignores_uninstallers_and_unrelated_folders() {
        let dir = TestDir::new();
        dir.file("TOM Tools/unins000.exe");
        dir.file("TOM Tools/readme.txt");
        dir.file("Games/Games.exe");
        assert_eq!(scan(dir.path()), Vec::<PathBuf>::new());
    }

    #[test]
    fn resolves_a_chosen_program_or_explains_why_not() {
        let dir = TestDir::new();
        let program = dir.file("anywhere/TOM.exe");
        assert_eq!(resolve(&program), Ok(program.clone()));
        let bundled = dir.file("TOM 1.86.app/Contents/MacOS/launcher");
        assert_eq!(resolve(&bundled), Ok(bundled.clone()));
        let other = dir.file("Downloads/x.exe");
        assert!(resolve(&other).unwrap_err().contains("not a TOM program"));
        assert!(
            resolve(&dir.path().join("missing"))
                .unwrap_err()
                .contains("does not exist")
        );
        assert!(resolve(dir.path()).unwrap_err().contains("No TOM program"));
    }
}
