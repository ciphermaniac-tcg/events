//! Starting TOM the way Finder does, through `LaunchServices`, so it gets its
//! own Dock icon, name and app identity. A program exec'd straight from
//! `Contents/MacOS` shows up as its parent instead. TOM started this way is not
//! our child, so it is followed by pid.

use std::ffi::{OsStr, c_void};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2_app_kit::{
    NSApplicationActivationOptions, NSRunningApplication, NSWorkspace, NSWorkspaceOpenConfiguration,
};
use objc2_foundation::{NSBundle, NSDictionary, NSError, NSString, NSURL};

/// `LaunchServices` answers within a second or two; TOM's JVM starts after.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(30);

/// The program a process runs, from the kernel.
pub(crate) fn process_path(pid: libc::pid_t) -> Option<PathBuf> {
    let mut buffer = vec![0u8; usize::try_from(libc::PROC_PIDPATHINFO_MAXSIZE).ok()?];
    let size = u32::try_from(buffer.len()).ok()?;
    // SAFETY: the buffer is as large as we say.
    let len = unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast::<c_void>(), size) };
    buffer.truncate(usize::try_from(len).ok().filter(|&len| len > 0)?);
    Some(PathBuf::from(String::from_utf8_lossy(&buffer).into_owned()))
}

/// The process is alive and still runs `program`, so a recycled pid is not
/// mistaken for TOM.
pub(crate) fn alive(pid: u32, program: &Path) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 only checks that the process exists.
    let exists = unsafe { libc::kill(pid, 0) } == 0
        || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
    exists && process_path(pid).is_some_and(|path| same_file(&path, program))
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn file_url(path: &Path) -> Result<objc2::rc::Retained<NSURL>, String> {
    let text = path
        .to_str()
        .ok_or_else(|| format!("{} cannot be opened.", path.display()))?;
    Ok(NSURL::fileURLWithPath(&NSString::from_str(text)))
}

/// Brings the app running as `pid` to the front, with all its windows.
pub(crate) fn activate(pid: u32) {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return;
    };
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
    }
}

/// Whether any copy of this app is running, matched by its bundle identifier.
pub(crate) fn running(app: &Path) -> bool {
    let identifier = file_url(app)
        .ok()
        .and_then(|url| NSBundle::bundleWithURL(&url))
        .and_then(|bundle| bundle.bundleIdentifier());
    identifier.is_some_and(|identifier| {
        NSRunningApplication::runningApplicationsWithBundleIdentifier(&identifier).count() > 0
    })
}

/// Opens a new instance of `app` with these environment variables and
/// returns its pid once `LaunchServices` has started it.
pub(crate) fn open(app: &Path, environment: &[(&str, &OsStr)]) -> Result<u32, String> {
    let url = file_url(app)?;
    let config = NSWorkspaceOpenConfiguration::configuration();
    config.setCreatesNewApplicationInstance(true);
    config.setActivates(true);
    let environment = dictionary(environment)?;
    config.setEnvironment(&environment);

    let (sender, receiver) = mpsc::channel::<Result<u32, String>>();
    let handler = RcBlock::new(move |app: *mut NSRunningApplication, error: *mut NSError| {
        // SAFETY: LaunchServices passes a valid application or error, or null.
        let result = unsafe { launched(app.as_ref(), error.as_ref()) };
        let _ = sender.send(result);
    });
    NSWorkspace::sharedWorkspace().openApplicationAtURL_configuration_completionHandler(
        &url,
        &config,
        Some(&handler),
    );
    receiver
        .recv_timeout(LAUNCH_TIMEOUT)
        .map_err(|_| "macOS did not report whether TOM started.".to_owned())?
}

fn launched(app: Option<&NSRunningApplication>, error: Option<&NSError>) -> Result<u32, String> {
    if let Some(app) = app {
        return u32::try_from(app.processIdentifier())
            .map_err(|_| "macOS started TOM but gave no process id.".to_owned());
    }
    let why = error.map_or_else(
        || "no reason given".to_owned(),
        |e| e.localizedDescription().to_string(),
    );
    Err(format!("TOM could not be started: {why}"))
}

/// The variables exactly as given: no shell sits in between, so quoting
/// inside a value (paths with spaces) reaches TOM's JVM unchanged.
fn dictionary(
    environment: &[(&str, &OsStr)],
) -> Result<objc2::rc::Retained<NSDictionary<NSString, NSString>>, String> {
    let mut keys = Vec::new();
    let mut values = Vec::new();
    for (key, value) in environment {
        let value = value
            .to_str()
            .ok_or_else(|| format!("{key} holds text macOS cannot pass on."))?;
        keys.push(NSString::from_str(key));
        values.push(NSString::from_str(value));
    }
    let keys: Vec<&NSString> = keys.iter().map(AsRef::as_ref).collect();
    let values: Vec<&NSString> = values.iter().map(AsRef::as_ref).collect();
    Ok(NSDictionary::from_slices(&keys, &values))
}
