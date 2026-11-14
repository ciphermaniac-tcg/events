//! Keys mode: types codes into TOM's Speed Match Slip Entry with operating
//! system keystrokes, the way a barcode scanner would.
//!
//! The OS shows TOM's window titles but none of its controls, so every step
//! is guarded by a title check: nothing is typed unless the foreground window
//! is "Speed Match Slip Entry", and Enter is not pressed if focus moved while
//! typing. A rejected code shows a window titled "Error", which is dismissed
//! with Enter. Keys mode cannot see the auto-save checkbox, so the operator
//! must tick it; without it TOM only previews each code.

use std::thread;
use std::time::{Duration, Instant};

use crate::code::Entry;
use crate::results::{SaveResult, SubmitResult, TomView, submit_each};

#[cfg(target_os = "linux")]
mod x11;
#[cfg(target_os = "linux")]
pub(crate) use x11::Platform;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub(crate) use windows::Platform;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub(crate) use macos::Platform;

pub(crate) const SLIP: &str = "Speed Match Slip Entry";
pub(crate) const ERROR: &str = "Error";
pub(crate) const MAIN_PREFIX: &str = "Tournament Operations Manager";
pub(crate) const TOURNAMENT_MARK: &str = " - Tournament: ";

const NOT_RUNNING: &str = "TOM is not running, or is still on its sign-in window.";
const SHOWING_ERROR: &str = "TOM is showing an error. Close it in TOM, then try again.";
const OPEN_SLIP: &str =
    "Open Speed Match Slip Entry in TOM and tick \"Automatically save valid scans.\" first.";

/// A top-level window as the OS reports it.
#[derive(Clone, Debug)]
pub(crate) struct OsWindow<H> {
    pub handle: H,
    pub title: String,
    pub pid: Option<u32>,
}

/// The focused window as the OS reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Foreground {
    pub title: String,
    pub pid: Option<u32>,
}

/// The few OS abilities keys mode needs. One implementation per platform.
pub(crate) trait Desktop {
    type Handle: Clone;
    type Focus;

    /// Whether this app may send keystrokes; `prompt` may ask the OS to ask the user.
    fn check_access(&mut self, _prompt: bool) -> Result<(), String> {
        Ok(())
    }
    /// Visible top-level windows of every app.
    fn windows(&mut self) -> Result<Vec<OsWindow<Self::Handle>>, String>;
    /// Whatever has focus now, so it can be given back.
    fn focus(&mut self) -> Result<Self::Focus, String>;
    /// The window that has keyboard focus, and the process it belongs to.
    fn foreground(&mut self) -> Result<Option<Foreground>, String>;
    fn activate(&mut self, window: &Self::Handle) -> Result<(), String>;
    fn type_digits(&mut self, digits: &str) -> Result<(), String>;
    fn press_enter(&mut self) -> Result<(), String>;
    /// Ctrl+S, or Cmd+S on macOS.
    fn press_save(&mut self) -> Result<(), String>;
    fn restore(&mut self, focus: Self::Focus) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Timing {
    /// How long TOM gets to show an Error dialog after Enter.
    pub settle: Duration,
    /// How long a window gets to come to the front.
    pub focus_wait: Duration,
    pub poll: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            settle: Duration::from_millis(800),
            focus_wait: Duration::from_millis(1500),
            poll: Duration::from_millis(50),
        }
    }
}

/// TOM's windows: those of any process that owns a window titled like TOM's main one.
fn tom_windows<H: Clone>(all: Vec<OsWindow<H>>) -> Vec<OsWindow<H>> {
    let is_tom = |window: &OsWindow<H>| window.title.starts_with(MAIN_PREFIX);
    let pids: Vec<u32> = all
        .iter()
        .filter(|w| is_tom(w))
        .filter_map(|w| w.pid)
        .collect();
    all.into_iter()
        .filter(|w| is_tom(w) || w.pid.is_some_and(|pid| pids.contains(&pid)))
        .collect()
}

fn find<'a, H>(windows: &'a [OsWindow<H>], title: &str) -> Option<&'a OsWindow<H>> {
    windows.iter().find(|w| w.title == title)
}

fn current<D: Desktop>(desktop: &mut D) -> Result<Vec<OsWindow<D::Handle>>, String> {
    let windows = tom_windows(desktop.windows()?);
    if windows.is_empty() {
        Err(NOT_RUNNING.into())
    } else {
        Ok(windows)
    }
}

/// The slip form, when TOM is ready to take a code there.
fn ready_slip<D: Desktop>(desktop: &mut D) -> Result<OsWindow<D::Handle>, String> {
    let windows = current(desktop)?;
    if find(&windows, ERROR).is_some() {
        return Err(SHOWING_ERROR.into());
    }
    find(&windows, SLIP)
        .cloned()
        .ok_or_else(|| OPEN_SLIP.into())
}

fn wait_until(timing: Timing, mut done: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timing.focus_wait;
    loop {
        if done() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(timing.poll);
    }
}

/// The focused window is this one of TOM's: same title and same process, so
/// a look-alike window in another app never receives a code.
fn foreground_is<D: Desktop, H>(desktop: &mut D, window: &OsWindow<H>) -> bool {
    let Ok(Some(focused)) = desktop.foreground() else {
        return false;
    };
    focused.title == window.title && focused.pid.is_some() && focused.pid == window.pid
}

fn bring_forward<D: Desktop>(
    desktop: &mut D,
    timing: Timing,
    window: &OsWindow<D::Handle>,
) -> Result<(), String> {
    desktop.activate(&window.handle)?;
    if wait_until(timing, || foreground_is(desktop, window)) {
        Ok(())
    } else {
        Err(format!(
            "TOM's \"{}\" window could not be brought to the front, so nothing was typed.",
            window.title
        ))
    }
}

pub(crate) fn tom_running<D: Desktop>(desktop: &mut D) -> bool {
    desktop
        .windows()
        .is_ok_and(|windows| !tom_windows(windows).is_empty())
}

pub(crate) fn view<D: Desktop>(desktop: &mut D) -> TomView {
    let windows = match desktop.check_access(false).and_then(|()| current(desktop)) {
        Ok(windows) => windows,
        Err(reason) => return TomView::unavailable(reason),
    };
    let slip_dialog_open = find(&windows, SLIP).is_some();
    let reason = if find(&windows, ERROR).is_some() {
        Some(SHOWING_ERROR.to_owned())
    } else {
        (!slip_dialog_open).then(|| OPEN_SLIP.to_owned())
    };
    TomView {
        ready: reason.is_none(),
        reason,
        tournament_open: windows.iter().any(|w| w.title.contains(TOURNAMENT_MARK)),
        slip_dialog_open,
        windows: windows.into_iter().map(|w| w.title).collect(),
        pods: Vec::new(),
    }
}

pub(crate) fn submit<D: Desktop>(
    desktop: &mut D,
    timing: Timing,
    entries: &[Entry],
) -> Vec<SubmitResult> {
    if let Err(reason) = desktop.check_access(true) {
        return entries
            .iter()
            .map(|entry| SubmitResult::not_ready(&entry.code, reason.clone()))
            .collect();
    }
    let focus = desktop.focus().ok();
    let results = submit_each(entries, |entry| send(desktop, timing, &entry.code));
    if let Some(focus) = focus {
        let _ = desktop.restore(focus);
    }
    results
}

fn send<D: Desktop>(desktop: &mut D, timing: Timing, code: &str) -> SubmitResult {
    match type_code(desktop, timing, code) {
        Ok(slip) => outcome(desktop, timing, code, &slip),
        Err(reason) => SubmitResult::not_ready(code, reason),
    }
}

fn type_code<D: Desktop>(
    desktop: &mut D,
    timing: Timing,
    code: &str,
) -> Result<OsWindow<D::Handle>, String> {
    let slip = ready_slip(desktop)?;
    bring_forward(desktop, timing, &slip)?;
    desktop.type_digits(code)?;
    if !foreground_is(desktop, &slip) {
        return Err(format!(
            "Focus left {SLIP} while typing, so Enter was not pressed. Clear the Result Code field in TOM."
        ));
    }
    desktop.press_enter()?;
    Ok(slip)
}

fn outcome<D: Desktop>(
    desktop: &mut D,
    timing: Timing,
    code: &str,
    slip: &OsWindow<D::Handle>,
) -> SubmitResult {
    thread::sleep(timing.settle);
    let windows = match desktop.windows().map(tom_windows) {
        Ok(windows) => windows,
        Err(reason) => return SubmitResult::uncertain(code, unseen(&reason)),
    };
    let Some(error) = find(&windows, ERROR).cloned() else {
        return seen_without_error(code, &windows);
    };
    match dismiss(desktop, timing, &error, slip) {
        Ok(()) => SubmitResult::rejected(code, "TOM rejected the code."),
        Err(_) => SubmitResult::rejected(
            code,
            "TOM rejected the code. Close its Error dialog before sending more.",
        ),
    }
}

fn unseen(why: &str) -> String {
    format!("{why} TOM may or may not have recorded this code. Check TOM before sending it again.")
}

/// No Error window: accepted only while TOM and its slip form are still there
/// to have taken the code. A vanished form may mean Enter pressed a button.
fn seen_without_error<H>(code: &str, windows: &[OsWindow<H>]) -> SubmitResult {
    if windows.is_empty() {
        return SubmitResult::uncertain(code, unseen("TOM closed right after the code was sent."));
    }
    if find(windows, SLIP).is_none() {
        return SubmitResult::uncertain(
            code,
            unseen(&format!("{SLIP} closed right after the code was sent.")),
        );
    }
    SubmitResult::accepted(code)
}

/// Presses OK on TOM's Error dialog, then hands focus back to the slip form's field.
fn dismiss<D: Desktop>(
    desktop: &mut D,
    timing: Timing,
    error: &OsWindow<D::Handle>,
    slip: &OsWindow<D::Handle>,
) -> Result<(), String> {
    bring_forward(desktop, timing, error)?;
    desktop.press_enter()?;
    let closed = wait_until(timing, || {
        desktop
            .windows()
            .map(tom_windows)
            .is_ok_and(|w| find(&w, ERROR).is_none())
    });
    if !closed {
        return Err(SHOWING_ERROR.into());
    }
    bring_forward(desktop, timing, slip)
}

pub(crate) fn save<D: Desktop>(desktop: &mut D, timing: Timing) -> SaveResult {
    if let Err(reason) = desktop.check_access(true) {
        return SaveResult::not_ready(reason);
    }
    let main = match save_target(desktop) {
        Ok(main) => main,
        Err(reason) => return SaveResult::not_ready(reason),
    };
    let focus = desktop.focus().ok();
    let saved = bring_forward(desktop, timing, &main).and_then(|()| desktop.press_save());
    thread::sleep(timing.settle);
    if let Some(focus) = focus {
        let _ = desktop.restore(focus);
    }
    match saved {
        Ok(()) => SaveResult::Saved,
        Err(reason) => SaveResult::not_ready(reason),
    }
}

/// TOM's main window, when nothing modal is in front of it.
fn save_target<D: Desktop>(desktop: &mut D) -> Result<OsWindow<D::Handle>, String> {
    let windows = current(desktop)?;
    if find(&windows, SLIP).is_some() {
        return Err(format!(
            "TOM cannot save while {SLIP} is open. Close it in TOM, or use inside mode."
        ));
    }
    if let Some(other) = windows.iter().find(|w| !w.title.starts_with(MAIN_PREFIX)) {
        return Err(format!(
            "TOM has the \"{}\" window open. Close it, then try again.",
            other.title
        ));
    }
    windows
        .into_iter()
        .find(|w| w.title.contains(TOURNAMENT_MARK))
        .ok_or_else(|| "No tournament is open in TOM.".into())
}

#[cfg(test)]
mod tests;
