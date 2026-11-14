//! Feeds match results into Pokemon's Tournament Operations Manager (TOM)
//! through its Speed Match Slip Entry form, the input TOM gives barcode
//! scanners.
//!
//! Two modes share one interface and one result type:
//! [`Mode::Inside`] talks to a helper loaded into TOM's own JVM, which needs
//! TOM to be launched through [`Bridge::launch`]; [`Mode::Keys`] types into
//! TOM's window with operating-system keystrokes, for a TOM started any way.
//! Every code is checked with [`vet`] before either mode sends it.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;

mod code;
mod inside;
mod keys;
mod locate;
mod results;
#[cfg(test)]
mod testdir;

pub use code::vet;
pub use locate::{detect, resolve};
pub use results::{Mode, PodStatus, SaveResult, StartResult, Status, SubmitResult};

use keys::{Platform, Timing};
use results::TomView;

const NOT_LAUNCHED: &str = "Launch TOM from here to use inside mode.";

/// The desktop app's handle on TOM.
pub struct Bridge {
    mode: Mode,
    tom_path: Option<PathBuf>,
    tom: Option<inside::Tom>,
    timing: Timing,
}

impl Bridge {
    #[must_use]
    pub fn new(mode: Mode, tom_path: Option<PathBuf>) -> Self {
        Self {
            mode,
            tom_path,
            tom: None,
            timing: Timing::default(),
        }
    }

    #[must_use]
    pub fn mode(&self) -> Mode {
        self.mode
    }

    pub fn set_mode(&mut self, mode: Mode) {
        self.mode = mode;
    }

    #[must_use]
    pub fn tom_path(&self) -> Option<&Path> {
        self.tom_path.as_deref()
    }

    /// Remembers which TOM to launch, from an `.app`, install folder or program.
    ///
    /// # Errors
    /// When the path holds no TOM program.
    pub fn set_tom_path(&mut self, path: &Path) -> Result<PathBuf, String> {
        let program = resolve(path)?;
        self.tom_path = Some(program.clone());
        Ok(program)
    }

    /// Starts TOM with the helper jar loaded, finding TOM first if needed.
    ///
    /// # Errors
    /// When TOM cannot be found or started, or is already open.
    pub fn launch(&mut self, helper_jar: &Path) -> Result<(), String> {
        if self.tom_path.is_none() {
            self.tom_path = detect().into_iter().next();
        }
        let program = self
            .tom_path
            .clone()
            .ok_or("TOM was not found. Choose where it is installed.")?;
        self.launch_with(Command::new(program), helper_jar)
    }

    /// [`Bridge::launch`] with a caller-built command, such as a wrapper script.
    ///
    /// # Errors
    /// When TOM cannot be started, or is already open.
    pub fn launch_with(&mut self, command: Command, helper_jar: &Path) -> Result<(), String> {
        if self.launched() {
            return Ok(());
        }
        if open_elsewhere(self.tom_path.as_deref()) {
            return Err("TOM is already open. Close it, then launch it from here.".into());
        }
        self.tom = Some(inside::Tom::spawn(command, helper_jar)?);
        Ok(())
    }

    /// TOM is running as this app's child.
    pub fn launched(&mut self) -> bool {
        self.tom.as_mut().is_some_and(inside::Tom::running)
    }

    pub fn status(&mut self) -> Status {
        let view = match self.mode {
            Mode::Inside => self
                .tom
                .as_mut()
                .map_or_else(|| TomView::unavailable(NOT_LAUNCHED), inside::Tom::view),
            Mode::Keys => with_desktop(self.tom_path.as_deref(), keys::view, TomView::unavailable),
        };
        Status {
            mode: self.mode,
            tom_path: self.tom_path.clone(),
            launched: self.launched(),
            ready: view.ready,
            reason: view.reason,
            tournament_open: view.tournament_open,
            slip_dialog_open: view.slip_dialog_open,
            windows: view.windows,
            pods: view.pods,
        }
    }

    /// Sends codes in order. Each is vetted first; once TOM is not ready, the
    /// rest are reported not ready without being sent.
    pub fn submit(&mut self, codes: &[String]) -> Vec<SubmitResult> {
        let timing = self.timing;
        let all_not_ready = |reason: String| {
            codes
                .iter()
                .map(|code| SubmitResult::not_ready(code, reason.clone()))
                .collect()
        };
        match (self.mode, self.tom.as_mut()) {
            (Mode::Inside, Some(tom)) => results::submit_each(codes, |code| tom.submit(code)),
            (Mode::Inside, None) => all_not_ready(NOT_LAUNCHED.into()),
            (Mode::Keys, _) => with_desktop(
                self.tom_path.as_deref(),
                |desktop| keys::submit(desktop, timing, codes),
                all_not_ready,
            ),
        }
    }

    /// Presses TOM's Start Round for a pod (TOM category code), or for the
    /// only pod when `category` is `None`. Already started counts as success.
    pub fn start_round(&mut self, category: Option<u8>) -> StartResult {
        match (self.mode, self.tom.as_mut()) {
            (Mode::Inside, Some(tom)) => tom.start_round(category),
            (Mode::Inside, None) => StartResult::not_ready(NOT_LAUNCHED),
            (Mode::Keys, _) => StartResult::not_ready(
                "Keys mode cannot see TOM's pods. Press Start Round in TOM, or use inside mode.",
            ),
        }
    }

    /// Asks TOM to save its tournament file.
    pub fn save(&mut self) -> SaveResult {
        let timing = self.timing;
        match (self.mode, self.tom.as_mut()) {
            (Mode::Inside, Some(tom)) => tom.save(),
            (Mode::Inside, None) => SaveResult::not_ready(NOT_LAUNCHED),
            (Mode::Keys, _) => with_desktop(
                self.tom_path.as_deref(),
                |desktop| keys::save(desktop, timing),
                SaveResult::not_ready,
            ),
        }
    }
}

fn with_desktop<T>(
    tom_path: Option<&Path>,
    run: impl FnOnce(&mut Platform) -> T,
    unavailable: impl FnOnce(String) -> T,
) -> T {
    match Platform::open(tom_path) {
        Ok(mut desktop) => run(&mut desktop),
        Err(reason) => unavailable(reason),
    }
}

/// A TOM this app did not start already has windows open.
fn open_elsewhere(tom_path: Option<&Path>) -> bool {
    with_desktop(tom_path, keys::tom_running, |_| false)
}

pub(crate) fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the OS random number generator is unavailable");
    buffer.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inside_mode_needs_a_launch_first() {
        let mut bridge = Bridge::new(Mode::Inside, None);
        let status = bridge.status();
        assert!(!status.ready && !status.launched);
        assert_eq!(status.reason.as_deref(), Some(NOT_LAUNCHED));
        let results = bridge.submit(&["21113".to_owned()]);
        assert_eq!(results, [SubmitResult::not_ready("21113", NOT_LAUNCHED)]);
        assert_eq!(bridge.save(), SaveResult::not_ready(NOT_LAUNCHED));
        assert_eq!(
            bridge.start_round(Some(2)),
            StartResult::not_ready(NOT_LAUNCHED)
        );
    }

    #[test]
    fn remembers_a_resolved_tom_path() {
        let dir = testdir::TestDir::new();
        let program = dir.file("TOM.app/Contents/MacOS/TOM");
        let mut bridge = Bridge::new(Mode::Keys, None);
        assert_eq!(
            bridge.set_tom_path(&dir.path().join("TOM.app")),
            Ok(program.clone())
        );
        assert_eq!(bridge.tom_path(), Some(program.as_path()));
        assert!(bridge.set_tom_path(&dir.path().join("nothing")).is_err());
    }
}
