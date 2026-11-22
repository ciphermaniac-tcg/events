//! Feeds match results into Pokemon's Tournament Operations Manager (TOM)
//! through its Speed Match Slip Entry form, the input TOM gives barcode
//! scanners.
//!
//! A helper loaded into TOM's own JVM does the entering, so TOM has to be
//! started through [`Bridge::launch`]. Every code is checked with [`vet`]
//! before it is sent.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;

mod code;
mod inside;
mod locate;
#[cfg(target_os = "macos")]
mod macos_app;
mod results;
mod running;
#[cfg(test)]
mod testdir;

pub use code::{Entry, vet};
pub use locate::{detect, resolve};
pub use results::{PodStatus, SaveResult, StartResult, Status, SubmitResult};

use results::TomView;

const NOT_LAUNCHED: &str = "Launch TOM from here to send it results.";
/// The helper can only be added as TOM starts, never to a running TOM.
const ALREADY_OPEN: &str = "TOM is already open without the helper, which can only be added as TOM starts. Quit TOM, then launch it from here.";

/// The desktop app's handle on TOM.
pub struct Bridge {
    tom_path: Option<PathBuf>,
    tom: Option<inside::Tom>,
}

impl Bridge {
    #[must_use]
    pub fn new(tom_path: Option<PathBuf>) -> Self {
        Self {
            tom_path,
            tom: None,
        }
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
        #[cfg(target_os = "macos")]
        if let Some(app) = locate::bundle_of(&program) {
            return self.launch_app(&app, &program, helper_jar);
        }
        self.launch_with(Command::new(program), helper_jar)
    }

    /// macOS: opens the `.app` through `LaunchServices`, so TOM shows its own
    /// Dock icon and name rather than this app's.
    #[cfg(target_os = "macos")]
    fn launch_app(&mut self, app: &Path, program: &Path, helper_jar: &Path) -> Result<(), String> {
        if self.launched() {
            return Ok(());
        }
        if macos_app::running(app) {
            return Err(ALREADY_OPEN.into());
        }
        self.tom = Some(inside::Tom::open_app(app, program, helper_jar)?);
        Ok(())
    }

    /// [`Bridge::launch`] with a caller-built command, such as a wrapper script.
    ///
    /// # Errors
    /// When TOM cannot be started, or is already open.
    pub fn launch_with(&mut self, command: Command, helper_jar: &Path) -> Result<(), String> {
        if self.launched() {
            return Ok(());
        }
        if running::elsewhere(self.tom_path.as_deref()) {
            return Err(ALREADY_OPEN.into());
        }
        self.tom = Some(inside::Tom::spawn(command, helper_jar)?);
        Ok(())
    }

    /// The TOM this app started is still running.
    pub fn launched(&mut self) -> bool {
        self.tom.as_mut().is_some_and(inside::Tom::running)
    }

    pub fn status(&mut self) -> Status {
        let view = self
            .tom
            .as_mut()
            .map_or_else(|| TomView::unavailable(NOT_LAUNCHED), inside::Tom::view);
        Status {
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

    /// Sends entries in order. Each is vetted against its own layout first;
    /// the batch stops at the first entry that is not accepted. Afterwards,
    /// whatever happened, TOM's slip form is closed again if the helper opened it.
    /// With a `tournament` name, TOM must have that tournament open, and only it.
    pub fn submit(&mut self, entries: &[Entry], tournament: Option<&str>) -> Vec<SubmitResult> {
        match self.tom.as_mut() {
            Some(tom) => {
                let results = results::submit_each(entries, |entry| tom.submit(entry, tournament));
                tom.finish();
                results
            }
            None => entries
                .iter()
                .map(|entry| SubmitResult::not_ready(&entry.code, NOT_LAUNCHED))
                .collect(),
        }
    }

    /// Presses TOM's Start Round for a pod (TOM category code), or for the
    /// only pod when `category` is `None`. Already started counts as success.
    /// With a `tournament` name, TOM must have that tournament open, and only it.
    pub fn start_round(&mut self, category: Option<u8>, tournament: Option<&str>) -> StartResult {
        self.tom.as_mut().map_or_else(
            || StartResult::not_ready(NOT_LAUNCHED),
            |tom| tom.start_round(category, tournament),
        )
    }

    /// Asks TOM to save its tournament file.
    pub fn save(&mut self) -> SaveResult {
        self.tom
            .as_mut()
            .map_or_else(|| SaveResult::not_ready(NOT_LAUNCHED), inside::Tom::save)
    }
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
    fn needs_a_launch_first() {
        let mut bridge = Bridge::new(None);
        let status = bridge.status();
        assert!(!status.ready && !status.launched);
        assert_eq!(status.reason.as_deref(), Some(NOT_LAUNCHED));
        let results = bridge.submit(&[code::entry(2, None, 1, 1, 1, "21113")], None);
        assert_eq!(results, [SubmitResult::not_ready("21113", NOT_LAUNCHED)]);
        assert_eq!(bridge.save(), SaveResult::not_ready(NOT_LAUNCHED));
        assert_eq!(
            bridge.start_round(Some(2), None),
            StartResult::not_ready(NOT_LAUNCHED)
        );
    }

    /// The ops the fake helper was asked for, in order.
    fn ops(seen: &[String]) -> Vec<String> {
        seen.iter()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap()["op"].to_string())
            .collect()
    }

    #[test]
    fn closes_the_slip_form_after_every_batch() {
        const ACCEPTED: [&str; 2] = [r#"{"result":"accepted"}"#, r#"{"result":"finished"}"#];
        const REJECTED: [&str; 2] = [
            r#"{"result":"rejected","message":"no"}"#,
            r#"{"result":"finished"}"#,
        ];
        let entries = [code::entry(2, None, 1, 1, 1, "21113")];
        for replies in [&ACCEPTED, &REJECTED] {
            let (tom, server) = inside::tests::fake_tom(replies);
            let mut bridge = Bridge {
                tom_path: None,
                tom: Some(tom),
            };
            bridge.submit(&entries, None);
            assert_eq!(ops(&server.join().unwrap()), [r#""submit""#, r#""finish""#]);
            if let Some(tom) = bridge.tom.as_mut() {
                tom.kill();
            }
        }
    }

    #[test]
    fn remembers_a_resolved_tom_path() {
        let dir = testdir::TestDir::new();
        let program = dir.file("TOM.app/Contents/MacOS/TOM");
        let mut bridge = Bridge::new(None);
        assert_eq!(
            bridge.set_tom_path(&dir.path().join("TOM.app")),
            Ok(program.clone())
        );
        assert_eq!(bridge.tom_path(), Some(program.as_path()));
        assert!(bridge.set_tom_path(&dir.path().join("nothing")).is_err());
    }
}
