//! TOM, the tournament software a TOM-run event's results go into. Desktop
//! only, and off until the person turns it on for this computer in a native
//! dialog the site cannot answer: the site may only ask. The choice is kept
//! in the app's config (tom.json), never on the site.
//!
//! While it is on, the app keeps TOM open with its helper (`tom_link`): it
//! finds TOM, or has the person pick it as TOM is turned on, launches it, and
//! launches it again whenever it quits, until `TRIES` launches in a row never
//! came up ("TOM didn't open", until the person tries again). It follows the
//! .tdf TOM has open, at the path TOM's helper reports, and hands the site
//! that file's text, never a path or any file access. The site sends results
//! with `tom_submit`, whose checks all live in the helper. The TOM menu
//! (`menu`) is in the menu bar only while TOM is on.
//!
//! Commands the site may call (`capabilities/site.json`), as JSON:
//!
//! - `tom_state()` -> `State`.
//! - `tom_read(since: number, source: number)` -> `{ modified: number, text: string } | null`:
//!   the .tdf as last read, when its `modified` (milliseconds since 1970,
//!   only ever growing within a source) is not `since`; null when it is, when TOM
//!   has since opened another file than `source`, while it cannot be read,
//!   and while TOM is off.
//! - `tom_confirm_event(source: number)` -> `boolean`: asks the person,
//!   natively, whether the file TOM has open (named by the app, from TOM's
//!   path) is the event's, for an event with no sanction ID. False when TOM
//!   has since opened another file than `source`.
//! - `tom_turn_on()` -> `boolean`: asks the person, natively, to turn TOM on;
//!   true once it is on.
//! - `tom_turn_off()` -> `null`. Needs no asking.
//! - `tom_show()` -> `null`: brings TOM to the front. Rejects with a sentence.
//! - `tom_retry()` -> `null`: after TOM didn't open, launches it again, no
//!   sooner than `RETRY_GAP` after the last series began.
//! - `tom_badge(count)` -> `null`: the Dock icon's count, cleared at 0 (not on Windows).
//! - `tom_submit(entries: Entry[], tournament?: string, tournamentId?: string, source?: number)`
//!   -> `SubmitResult[]`, one per entry, in order. With `tournament`, TOM must
//!   have that tournament (by name) open and no other, or nothing is sent;
//!   with `tournamentId` (the sanction ID), TOM's live data must hold it too.
//!   Each code must spell exactly its entry's layout (and never table 0) or it
//!   is rejected unsent. Nor is it sent unless TOM's live pairings read the
//!   code as that entry's match with `p1` and `p2` in its seats and no other
//!   result (`not_ready` otherwise); one TOM already holds is `accepted`
//!   untyped. The batch stops at the first entry that is not accepted: every
//!   later one comes back `not_ready`, unsent. A pod's paired round is
//!   started first when an entry is for it, after the same live check. When
//!   the batch ends, however it ends, Speed Match Slip Entry is closed again
//!   if the helper opened it, and auto-save is unticked again if the helper
//!   ticked it. Every entry is `not_ready` while TOM is off, and, given
//!   `source` (an event matched to a TOM file without a sanction ID), once
//!   TOM has opened another file than that one. Once TOM has
//!   taken results and none has followed for `SAVE_AFTER`, the app saves
//!   TOM's file through the helper, refused unless TOM has the same event
//!   open; the site has no save command of its own.
//! - `tom_start_round(pod?, round?, tournament?, tournamentId?, source?)` ->
//!   `StartResult`. `pod` is TOM's category code (0 Juniors, 1 Seniors, 2
//!   Masters, 8 Juniors and Seniors, 9 Seniors and Masters, 10 everyone); leave
//!   it out when the event has one pod. With `round`, TOM's pod must be on that
//!   round or nothing is pressed. `tournament` and `tournamentId` as for
//!   `tom_submit`, `source` too. `not_ready` while TOM is off.
//!
//! ```text
//! State = {
//!   on: boolean,
//!   tom: "open" | "reopening" | "failed",  // open: TOM's helper answers
//!   reason: string | null,                  // why TOM didn't open
//!   file: { name: string, source: number } | null  // the .tdf TOM has, or last had, open; source changes with the file
//! }
//! Entry = {                        // computed from the .tdf TOM saved
//!   pod: number,                   // category code: 0, 1, 2, 8, 9, 10
//!   flight?: number,               // only for a flighted pod in a Swiss round
//!   round: number,                 // as TOM numbers it (top cut keeps counting)
//!   table: number,                 // never 0
//!   outcome: number,               // 0 pending, 1 P1 wins, 2 P2 wins, 3 tie, 6 double loss
//!   code: string,                  // the slip code those parts make
//!   p1: string,                    // TOM player IDs in seats 1 and 2
//!   p2: string
//! }
//! SubmitResult =
//!   | { result: "accepted", code: string }
//!   | { result: "rejected", code: string, message: string }  // TOM's Error text, or the code check's
//!   | { result: "not_ready", code: string, reason: string }  // not sent; includes any TOM Error text
//!   | { result: "uncertain", code: string, reason: string }  // may have reached TOM; check TOM before resending
//! StartResult =
//!   | { result: "started" }
//!   | { result: "already_started" }                         // also a success
//!   | { result: "not_ready", reason: string }
//! ```

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError, TryLockError};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::{Submenu, SubmenuBuilder};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime, State, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogBuilder, MessageDialogButtons};
use tom_link::{Bridge, Entry, Event, SaveResult, StartResult, SubmitResult};

use crate::{menu, shell};

const CONFIG_FILE: &str = "tom.json";
const HELPER_JAR: &str = "resources/tom-bridge.jar";
/// How often the app looks at TOM while it is on.
const LOOK_EVERY: Duration = Duration::from_secs(2);
/// Launches in a row that never came up before TOM didn't open.
const TRIES: u8 = 3;
/// How long a running TOM may go without its helper answering: starting up, or stuck.
const STARTUP: Duration = Duration::from_secs(90);
/// The least time between the starts of two series of launches, however
/// often the site asks to try again.
const RETRY_GAP: Duration = Duration::from_secs(30);
/// How long after the last result TOM took the app saves TOM's file: the
/// site sends results one after another, so a run of them saves once.
const SAVE_AFTER: Duration = Duration::from_secs(3);
/// Saves tried for one run before the app leaves it to TOM's auto-save.
const SAVE_TRIES: u8 = 5;
const UNREACHABLE: &str = "TOM is open, but the app cannot reach it. Quit TOM, then try again.";
const CLOSED: &str = "TOM closed each time it was opened.";
const HERE: &str = if cfg!(target_os = "macos") {
    "this Mac"
} else {
    "this computer"
};
const OFF: &str = "TOM is off on this computer.";
const MOVED: &str = "TOM has opened another file since this event was matched to its file.";
const MENU: &str = "tom";
const SHOW: &str = "tom-show";
const WRITE: &str = "tom-write";
const TURN_OFF: &str = "tom-off";
/// The site's console writes the results to a .tdf when the TOM menu asks.
const WRITE_SCRIPT: &str = "window.dispatchEvent(new Event('cm-tom-write'))";
/// The site's Settings reads TOM's state again when the TOM menu turns it off.
const CHANGED_SCRIPT: &str = "window.dispatchEvent(new Event('cm-tom'))";

/// What survives a restart.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    #[serde(default)]
    tom_path: Option<PathBuf>,
    #[serde(default)]
    on: bool,
}

/// TOM's state as the site sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Open,
    Reopening,
    Failed,
}

/// Keeping TOM open: launches TOM whenever it is not running, until `TRIES`
/// launches in a row never reached TOM's helper, a TOM already open cannot be
/// reached, or a running TOM's helper stays quiet past `STARTUP`. `failed`
/// says why, until the person tries again.
#[derive(Debug, Default)]
struct Keeper {
    tries: u8,
    failed: Option<String>,
    open: bool,
    /// The last launch's error, for when the tries run out.
    error: Option<String>,
    /// Since when a running TOM's helper has not answered.
    quiet: Option<Instant>,
    /// When this series of launches began.
    series: Option<Instant>,
    /// No launch before this: a retry waits out `RETRY_GAP`.
    not_before: Option<Instant>,
}

impl Keeper {
    /// Takes in a look at TOM: whether it runs, and whether its helper
    /// answered. True when TOM is to be launched now.
    fn look(&mut self, running: bool, answering: bool, now: Instant) -> bool {
        // TOM up starts afresh: a slow start that failed recovers, and the next series is a new one.
        if running && answering {
            *self = Self {
                open: true,
                ..Self::default()
            };
            return false;
        }
        self.open = false;
        self.quiet = (running && !answering).then(|| self.quiet.unwrap_or(now));
        if self
            .quiet
            .is_some_and(|since| now.duration_since(since) > STARTUP)
        {
            self.fail(UNREACHABLE.into());
        }
        if running || self.failed.is_some() || self.not_before.is_some_and(|at| now < at) {
            return false;
        }
        if self.tries >= TRIES {
            let why = self.error.take().unwrap_or_else(|| CLOSED.into());
            self.fail(why);
            return false;
        }
        self.tries += 1;
        self.series.get_or_insert(now);
        true
    }

    /// A launch that did not start TOM. One open already, beyond the app's
    /// reach, fails at once: launching again cannot help, and TOM stays open.
    fn launch_failed(&mut self, error: String) {
        if error == tom_link::ALREADY_OPEN {
            self.fail(error);
        } else {
            self.error = Some(error);
        }
    }

    fn fail(&mut self, why: String) {
        self.failed.get_or_insert(why);
    }

    /// After TOM didn't open, a new series, no sooner than `RETRY_GAP` after
    /// the last one began. Nothing while a series is under way.
    fn retry(&mut self) {
        if self.failed.is_some() {
            let not_before = self.series.map(|at| at + RETRY_GAP);
            *self = Self {
                not_before,
                ..Self::default()
            };
        }
    }

    fn phase(&self) -> Phase {
        if self.failed.is_some() {
            Phase::Failed
        } else if self.open {
            Phase::Open
        } else {
            Phase::Reopening
        }
    }
}

/// The .tdf TOM has open, as last read. `modified` only ever grows within a
/// source, so a save within the same millisecond still reads as new; `text` is
/// None while a newly opened file cannot be read yet.
#[derive(Clone)]
struct Followed {
    path: PathBuf,
    /// The file's modified time and length when read, to tell a new save.
    stamp: (u64, u64),
    modified: u64,
    text: Option<Arc<str>>,
}

#[derive(Serialize)]
struct FileState {
    name: String,
    /// Changes whenever TOM opens another file, so the site starts over.
    source: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TomState {
    on: bool,
    tom: Phase,
    /// Why TOM didn't open.
    reason: Option<String>,
    file: Option<FileState>,
}

#[derive(Serialize)]
pub struct Read {
    modified: u64,
    text: Arc<str>,
}

/// A save of TOM's file owed for the results TOM took: the event as sent,
/// when TOM took the latest of them, and the saves tried so far.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Unsaved {
    at: Instant,
    name: Option<String>,
    id: Option<String>,
    tries: u8,
}

#[derive(Default)]
struct Watch {
    keeper: Keeper,
    file: Option<Followed>,
    source: u32,
    unsaved: Option<Unsaved>,
}

impl Watch {
    /// The file as last read, unless it is still the read at `since`, or TOM
    /// has since opened another file than `source`: a read never crosses files.
    fn read(&self, since: u64, source: u32) -> Option<Read> {
        let file = self
            .file
            .as_ref()
            .filter(|file| self.source == source && file.modified != since)?;
        Some(Read {
            modified: file.modified,
            text: Arc::clone(file.text.as_ref()?),
        })
    }

    /// The name of the file TOM has open, when it is still `source`.
    fn name(&self, source: u32) -> Option<String> {
        self.file
            .as_ref()
            .filter(|_| self.source == source)
            .and_then(|file| file.path.file_name())
            .map(|name| name.to_string_lossy().into_owned())
    }

    /// The save owed, once the run of results TOM took has settled.
    fn save_due(&mut self, now: Instant) -> Option<Unsaved> {
        let at = self.unsaved.as_ref()?.at;
        (now.duration_since(at) >= SAVE_AFTER)
            .then(|| self.unsaved.take())
            .flatten()
    }

    /// A save TOM could not make (a window of its open, say) is tried again
    /// a few times, unless a newer run already owes one.
    fn save_failed(&mut self, save: Unsaved, now: Instant) {
        if self.unsaved.is_none() && save.tries + 1 < SAVE_TRIES {
            self.unsaved = Some(Unsaved {
                at: now,
                tries: save.tries + 1,
                ..save
            });
        }
    }

    /// TOM answering with no event open, or two, another file than the one
    /// followed, or the file gone: the last file is no longer TOM's.
    fn forget_unless(&mut self, path: Option<&Path>) {
        if self
            .file
            .as_ref()
            .is_some_and(|file| path != Some(file.path.as_path()) || !file.path.exists())
        {
            self.file = None;
        }
    }

    /// Takes in a read of TOM's file. Another file is another source; the
    /// same file halfway through a save keeps the save before it.
    /// A save older than the last one read (a backup copied over TOM's file)
    /// is another source too, so the site starts over and checks it for being older.
    fn take(&mut self, read: Followed) {
        let last = self
            .file
            .as_ref()
            .filter(|file| file.path == read.path && read.modified >= file.stamp.0);
        if last.is_none() {
            self.source += 1;
        } else if read.text.is_none() {
            return;
        }
        let modified = last.map_or(read.modified, |file| read.modified.max(file.modified + 1));
        self.file = Some(Followed { modified, ..read });
    }
}

fn stamp(meta: &fs::Metadata) -> (u64, u64) {
    let modified = meta
        .modified()
        .ok()
        .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |at| u64::try_from(at.as_millis()).unwrap_or(u64::MAX));
    (modified, meta.len())
}

/// The .tdf at `path` when it changed since `last` (its stamp), read whole:
/// a file that changed while it was read has no text this time. A .tdf only:
/// the path is TOM's, but nothing else is ever handed on.
fn read_tdf(path: &Path, last: Option<(u64, u64)>) -> Option<Followed> {
    let tdf = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tdf"));
    let before = stamp(&fs::metadata(path).ok().filter(|_| tdf)?);
    if last == Some(before) {
        return None;
    }
    let text = fs::read_to_string(path).ok();
    let settled = fs::metadata(path).is_ok_and(|meta| stamp(&meta) == before);
    let text = text.filter(|_| settled).map(Arc::from);
    Some(Followed {
        path: path.to_path_buf(),
        stamp: if text.is_some() { before } else { (0, 0) },
        modified: before.0,
        text,
    })
}

/// The bridge plus where its settings live, built on first use; commands
/// share it across threads.
pub struct Tom {
    app: AppHandle,
    shared: OnceLock<Arc<Shared>>,
}

struct Shared {
    bridge: Mutex<Bridge>,
    config: Option<PathBuf>,
    helper_jar: PathBuf,
    on: AtomicBool,
    watch: Mutex<Watch>,
    looking: AtomicBool,
    asking: AtomicBool,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Tom {
    pub fn new(app: &AppHandle) -> Self {
        Self {
            app: app.clone(),
            shared: OnceLock::new(),
        }
    }

    fn shared(&self) -> Arc<Shared> {
        Arc::clone(
            self.shared
                .get_or_init(|| Arc::new(Shared::load(&self.app))),
        )
    }

    /// Runs bridge work off the async runtime and the main thread: TOM can
    /// take seconds per code, and requests to it run one at a time.
    async fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce(&Arc<Shared>, &mut Bridge) -> T + Send + 'static,
    ) -> Result<T, String> {
        let shared = self.shared();
        tauri::async_runtime::spawn_blocking(move || work(&shared, &mut locked(&shared.bridge)))
            .await
            .map_err(|error| format!("The TOM bridge failed: {error}"))
    }
}

/// Turns TOM on or off for this computer: saves the choice first, then keeps
/// TOM open or stops, and shows the TOM menu or takes it away. TOM itself
/// stays open. Turning off stops at once even when the choice cannot be
/// saved, and says so.
fn set_on(app: &AppHandle, shared: &Arc<Shared>, bridge: &Bridge, on: bool) -> Result<(), String> {
    let saved = shared.switch(bridge, on);
    if shared.on() == on {
        if on {
            keep_open(shared);
        } else {
            badge(app, 0);
        }
        show_menu(app, on);
    }
    saved
}

impl Shared {
    /// The saved settings and a bridge that has not looked for TOM yet.
    fn load(app: &AppHandle) -> Self {
        let config = app
            .path()
            .app_config_dir()
            .ok()
            .map(|dir| dir.join(CONFIG_FILE));
        let saved: Saved = config
            .as_deref()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self {
            bridge: Mutex::new(Bridge::new(saved.tom_path)),
            config,
            helper_jar: helper_jar(app),
            on: AtomicBool::new(saved.on),
            watch: Mutex::default(),
            looking: AtomicBool::new(false),
            asking: AtomicBool::new(false),
        }
    }

    fn on(&self) -> bool {
        self.on.load(Ordering::Relaxed)
    }

    /// Why nothing goes to TOM now: TOM off on this computer, or, for an event
    /// matched to a TOM file without a sanction ID (`source`), TOM since on another file.
    fn refusal(&self, source: Option<u32>) -> Option<&'static str> {
        if !self.on() {
            return Some(OFF);
        }
        source
            .is_some_and(|source| locked(&self.watch).source != source)
            .then_some(MOVED)
    }

    /// The choice saved, then taken: on only once saved, off at once.
    fn switch(&self, bridge: &Bridge, on: bool) -> Result<(), String> {
        let saved = self.save_config(bridge, on);
        if saved.is_ok() || !on {
            self.on.store(on, Ordering::Relaxed);
            let mut watch = locked(&self.watch);
            // The source only grows, so the site never takes a new file for one it saw.
            *watch = Watch {
                source: watch.source,
                ..Watch::default()
            };
        }
        saved
    }

    /// Writes the settings whole, through a file beside them, so an
    /// interrupted write never leaves half a file.
    fn save_config(&self, bridge: &Bridge, on: bool) -> Result<(), String> {
        let Some(path) = &self.config else {
            return Err("This app has no settings folder.".into());
        };
        let saved = Saved {
            tom_path: bridge.tom_path().map(Path::to_path_buf),
            on,
        };
        let text = serde_json::to_string_pretty(&saved).map_err(|error| error.to_string())?;
        let partial = path.with_extension("json.partial");
        path.parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| fs::write(&partial, text))
            .and_then(|()| fs::rename(&partial, path))
            .map_err(|error| format!("The setting could not be saved: {error}"))
    }

    /// One look at TOM: launches it when it is not running, and reads the
    /// file it has open, outside the lock the site's reads take. Skipped
    /// while a request to TOM is under way, which says TOM is up anyway.
    fn look(&self) {
        let mut bridge = match self.bridge.try_lock() {
            Ok(bridge) => bridge,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return,
        };
        // Turned off while this look waited: the cleared state stays clear.
        if !self.on() {
            return;
        }
        let running = bridge.launched();
        let status = running.then(|| bridge.status());
        let answering = status.as_ref().is_some_and(|status| status.answering);
        let path = status.and_then(|status| status.file);
        let mut watch = locked(&self.watch);
        let launch = watch.keeper.look(running, answering, Instant::now());
        if answering {
            watch.forget_unless(path.as_deref());
        }
        let last = watch
            .file
            .as_ref()
            .map(|file| (file.path.clone(), file.stamp));
        let save = if answering {
            watch.save_due(Instant::now())
        } else {
            None
        };
        drop(watch);
        if let Some(save) = save {
            self.save(&mut bridge, save);
        }
        let changed = path.and_then(|path| {
            let stamp = last
                .filter(|(last, _)| *last == path)
                .map(|(_, stamp)| stamp);
            read_tdf(&path, stamp)
        });
        if let Some(read) = changed {
            locked(&self.watch).take(read);
        }
        if launch {
            self.launch(&mut bridge);
        }
    }

    /// Puts the results TOM took into its file now rather than at TOM's
    /// next auto-save, through the helper, refused unless TOM has the event open.
    fn save(&self, bridge: &mut Bridge, save: Unsaved) {
        let event = Event {
            name: save.name.as_deref(),
            id: save.id.as_deref(),
        };
        if let SaveResult::NotReady { reason } = bridge.save(event) {
            log::warn!("TOM did not save: {reason}");
            locked(&self.watch).save_failed(save, Instant::now());
        }
    }

    fn launch(&self, bridge: &mut Bridge) {
        match bridge.launch(&self.helper_jar) {
            Ok(()) => {
                if let Err(error) = self.save_config(bridge, true) {
                    log::warn!("{error}");
                }
            }
            Err(error) => {
                log::warn!("TOM did not open: {error}");
                locked(&self.watch).keeper.launch_failed(error);
            }
        }
    }
}

/// The bundled helper; in development builds, the copy next to the sources.
fn helper_jar(app: &AppHandle) -> PathBuf {
    let bundled = app.path().resolve(HELPER_JAR, BaseDirectory::Resource).ok();
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join(HELPER_JAR);
    match bundled {
        Some(path) if path.is_file() || !cfg!(debug_assertions) => path,
        _ => development,
    }
}

/// Starts looking at TOM on a beat, once: the beat runs for as long as the
/// app does, and looks only while TOM is on.
fn keep_open(shared: &Arc<Shared>) {
    if shared.looking.swap(true, Ordering::Relaxed) {
        return;
    }
    let shared = Arc::clone(shared);
    std::thread::spawn(move || {
        loop {
            if shared.on() {
                shared.look();
            }
            std::thread::sleep(LOOK_EVERY);
        }
    });
}

/// Asks the person, over the main window, whether to turn TOM on.
fn confirm(app: &AppHandle) -> bool {
    ask(
        app,
        &format!("Use TOM on {HERE}?"),
        "The app opens TOM, keeps it open, and sends it the results entered here. TOM's saves come back to the site by themselves.",
        "Turn On",
    )
}

/// A native question over the main window, which the site cannot answer.
fn ask(app: &AppHandle, title: &str, message: &str, yes: &str) -> bool {
    tell(app, title, message)
        .buttons(MessageDialogButtons::OkCancelCustom(
            yes.into(),
            "Cancel".into(),
        ))
        .blocking_show()
}

/// A native message over the main window.
fn tell(app: &AppHandle, title: &str, message: &str) -> MessageDialogBuilder<Wry> {
    let dialog = app.dialog().message(message).title(title);
    match app.get_webview_window(shell::MAIN_WINDOW) {
        Some(window) => dialog.parent(&window),
        None => dialog,
    }
}

/// Makes sure the app knows where TOM is: found in its usual folders, or
/// picked by the person. False when they cancel or pick no TOM.
fn find(app: &AppHandle, bridge: &mut Bridge) -> bool {
    if bridge.tom_path().is_some_and(Path::exists) || !tom_link::detect().is_empty() {
        return true;
    }
    let dialog = app.dialog().file().set_title("Where is TOM?");
    let dialog = match app.get_webview_window(shell::MAIN_WINDOW) {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    };
    let Some(picked) = dialog
        .blocking_pick_file()
        .and_then(|path| path.into_path().ok())
    else {
        return false;
    };
    match bridge.set_tom_path(&picked) {
        Ok(_) => true,
        Err(error) => {
            tell(app, "That is not TOM", &error).blocking_show();
            false
        }
    }
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its arguments by value"
)]
pub fn tom_state(tom: State<'_, Tom>) -> TomState {
    let shared = tom.shared();
    let watch = locked(&shared.watch);
    TomState {
        on: shared.on(),
        tom: watch.keeper.phase(),
        reason: watch.keeper.failed.clone(),
        file: watch.name(watch.source).map(|name| FileState {
            name,
            source: watch.source,
        }),
    }
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its arguments by value"
)]
pub fn tom_read(tom: State<'_, Tom>, since: u64, source: u32) -> Option<Read> {
    let shared = tom.shared();
    let watch = locked(&shared.watch);
    watch.read(since, source).filter(|_| shared.on())
}

#[tauri::command]
pub async fn tom_turn_on(app: AppHandle, tom: State<'_, Tom>) -> Result<bool, String> {
    let shared = tom.shared();
    if shared.on() {
        return Ok(true);
    }
    // One question at a time, however often the site asks.
    if shared.asking.swap(true, Ordering::Relaxed) {
        return Ok(false);
    }
    let answer = tom
        .run(move |shared, bridge| {
            let agreed = confirm(&app) && find(&app, bridge);
            if agreed {
                set_on(&app, shared, bridge, true)?;
            }
            Ok(agreed)
        })
        .await;
    shared.asking.store(false, Ordering::Relaxed);
    answer?
}

#[tauri::command]
pub async fn tom_turn_off(app: AppHandle, tom: State<'_, Tom>) -> Result<(), String> {
    tom.run(move |shared, bridge| set_on(&app, shared, bridge, false))
        .await?
}

#[tauri::command]
pub async fn tom_show(tom: State<'_, Tom>) -> Result<(), String> {
    tom.run(|shared, bridge| {
        if shared.on() {
            bridge.show()
        } else {
            Err(OFF.into())
        }
    })
    .await?
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its arguments by value"
)]
pub fn tom_retry(tom: State<'_, Tom>) {
    locked(&tom.shared().watch).keeper.retry();
}

/// Asks the person, natively, whether the file TOM has open (`name`) is the
/// event's, for an event with no sanction ID to tell. False while TOM is off.
#[tauri::command]
pub async fn tom_confirm_event(
    app: AppHandle,
    tom: State<'_, Tom>,
    source: u32,
) -> Result<bool, String> {
    let shared = tom.shared();
    // The file's name is the app's, from the path TOM's helper reported, never the site's.
    let name = locked(&shared.watch).name(source);
    let Some(name) = name.filter(|_| shared.on()) else {
        return Ok(false);
    };
    if shared.asking.swap(true, Ordering::Relaxed) {
        return Ok(false);
    }
    let answer = tauri::async_runtime::spawn_blocking(move || {
        ask(
            &app,
            &format!("TOM has {name} open. Use it for this event?"),
            "The site follows this file and sends its results to TOM.",
            "Use It",
        )
    })
    .await;
    shared.asking.store(false, Ordering::Relaxed);
    answer.map_err(|error| error.to_string())
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its arguments by value"
)]
pub fn tom_badge(app: AppHandle, count: u32) {
    badge(&app, count);
}

/// The Dock icon's count on the Mac, cleared at zero. Windows has no count
/// (only an overlay icon), so there it does nothing.
fn badge(app: &AppHandle, count: u32) {
    if let Some(window) = app.get_webview_window(shell::MAIN_WINDOW)
        && let Err(error) = window.set_badge_count((count > 0).then_some(i64::from(count)))
    {
        log::debug!("could not badge the app's icon: {error}");
    }
}

#[tauri::command]
pub async fn tom_submit(
    tom: State<'_, Tom>,
    entries: Vec<Entry>,
    tournament: Option<String>,
    tournament_id: Option<String>,
    source: Option<u32>,
) -> Result<Vec<SubmitResult>, String> {
    tom.run(move |shared, bridge| {
        if let Some(why) = shared.refusal(source) {
            return entries
                .iter()
                .map(|entry| SubmitResult::NotReady {
                    code: entry.code.clone(),
                    reason: why.into(),
                    held: None,
                })
                .collect();
        }
        let event = Event {
            name: tournament.as_deref(),
            id: tournament_id.as_deref(),
        };
        let results = bridge.submit(&entries, event);
        if results
            .iter()
            .any(|result| matches!(result, SubmitResult::Accepted { .. }))
        {
            locked(&shared.watch).unsaved = Some(Unsaved {
                at: Instant::now(),
                name: tournament,
                id: tournament_id,
                tries: 0,
            });
        }
        results
    })
    .await
}

#[tauri::command]
pub async fn tom_start_round(
    tom: State<'_, Tom>,
    pod: Option<u8>,
    round: Option<u8>,
    tournament: Option<String>,
    tournament_id: Option<String>,
    source: Option<u32>,
) -> Result<StartResult, String> {
    tom.run(move |shared, bridge| {
        if let Some(why) = shared.refusal(source) {
            return StartResult::NotReady { reason: why.into() };
        }
        let event = Event {
            name: tournament.as_deref(),
            id: tournament_id.as_deref(),
        };
        bridge.start_round(pod, round, event)
    })
    .await
}

/// Readies TOM: its state, built at once when TOM was left on (so TOM opens
/// with the app), else on the first TOM command; and the TOM menu's commands.
pub fn setup(app: &tauri::App) {
    let tom = Tom::new(app.handle());
    // Building the state reads the settings and nothing more: no TOM is looked for yet.
    let shared = tom.shared();
    if shared.on() {
        keep_open(&shared);
        show_menu(app.handle(), true);
    }
    app.manage(tom);
    app.on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        SHOW => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = tom_show(app.state()).await {
                    log::warn!("TOM could not come forward: {error}");
                }
            });
        }
        WRITE => {
            shell::reveal_main_window(app);
            if let Some(window) = app.get_webview_window(shell::MAIN_WINDOW)
                && window.url().is_ok_and(|url| shell::is_site(&url))
                && let Err(error) = window.eval(WRITE_SCRIPT)
            {
                log::warn!("could not write the results: {error}");
            }
        }
        TURN_OFF => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                // TOM is off at once either way; a setting the app could not save is said natively.
                if let Err(error) = tom_turn_off(app.clone(), app.state()).await {
                    tell(&app, "TOM is off for now", &error).show(drop);
                }
                if let Some(window) = app.get_webview_window(shell::MAIN_WINDOW) {
                    let _ = window.eval(CHANGED_SCRIPT);
                }
            });
        }
        _ => {}
    }
}

/// The TOM menu: Show TOM, Write results to .tdf, and Turn off TOM.
fn tom_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::with_id(app, MENU, "TOM")
        .item(&menu::item(app, SHOW, "Show TOM", Some("CmdOrCtrl+T"))?)
        .item(&menu::item(app, WRITE, "Write results to .tdf", None)?)
        .separator()
        .item(&menu::item(
            app,
            TURN_OFF,
            &format!("Turn off TOM on {HERE}"),
            None,
        )?)
        .build()
}

/// Puts the TOM menu in the menu bar, before Window and Help, or takes it out.
fn show_menu<R: Runtime>(app: &AppHandle<R>, on: bool) {
    let Some(bar) = app.menu() else {
        return;
    };
    let shown = bar.get(MENU);
    let done = match (on, shown) {
        (true, None) => bar
            .items()
            .and_then(|items| bar.insert(&tom_menu(app)?, items.len().saturating_sub(2))),
        (false, Some(menu)) => bar.remove(&menu),
        _ => Ok(()),
    };
    if let Err(error) = done {
        log::warn!("could not change the TOM menu: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Bridge, CLOSED, Keeper, Mutex, Path, Phase, RETRY_GAP, SAVE_AFTER, SAVE_TRIES, STARTUP,
        Shared, TRIES, Unsaved, Watch, locked, read_tdf,
    };
    use std::sync::atomic::AtomicBool;
    use std::time::{Duration, Instant};

    #[test]
    fn reopens_tom_until_it_fails_to_come_up() {
        let mut keeper = Keeper::default();
        let now = Instant::now();
        assert_eq!(keeper.phase(), Phase::Reopening);
        for _ in 0..TRIES {
            assert!(keeper.look(false, false, now), "TOM is launched again");
        }
        assert!(!keeper.look(false, false, now), "no more tries");
        assert_eq!(keeper.phase(), Phase::Failed);
        assert_eq!(keeper.failed.as_deref(), Some(CLOSED));
        assert!(
            !keeper.look(false, false, now),
            "it stays failed until tried again"
        );
    }

    #[test]
    fn a_tom_that_came_up_gets_its_tries_back() {
        let mut keeper = Keeper::default();
        let now = Instant::now();
        assert!(keeper.look(false, false, now));
        assert!(!keeper.look(true, false, now), "TOM is starting");
        assert_eq!(keeper.phase(), Phase::Reopening);
        assert!(!keeper.look(true, true, now));
        assert_eq!(keeper.phase(), Phase::Open);
        for _ in 0..TRIES {
            assert!(
                keeper.look(false, false, now),
                "TOM quit, so it opens again"
            );
        }
        assert_eq!(keeper.phase(), Phase::Reopening);
    }

    #[test]
    fn a_tom_whose_helper_never_answers_fails_after_a_while() {
        let mut keeper = Keeper::default();
        let start = Instant::now();
        assert!(keeper.look(false, false, start));
        assert!(!keeper.look(true, false, start));
        assert!(!keeper.look(true, false, start + STARTUP));
        assert_eq!(keeper.phase(), Phase::Reopening, "still starting");
        keeper.look(true, false, start + STARTUP + Duration::from_secs(1));
        assert_eq!(keeper.phase(), Phase::Failed);
    }

    #[test]
    fn a_tom_that_comes_up_after_failing_recovers_and_starts_its_series_afresh() {
        let mut keeper = Keeper::default();
        let start = Instant::now();
        assert!(keeper.look(false, false, start));
        keeper.look(true, false, start);
        keeper.look(true, false, start + STARTUP + Duration::from_secs(1));
        assert_eq!(keeper.phase(), Phase::Failed, "slow to start");
        keeper.look(true, true, start + STARTUP * 2);
        assert_eq!(keeper.phase(), Phase::Open, "it came up after all");
        let later = start + STARTUP * 20;
        for at in 0..TRIES {
            assert!(keeper.look(false, false, later + Duration::from_secs(at.into())));
        }
        keeper.look(false, false, later + Duration::from_secs(5));
        keeper.retry();
        assert!(
            !keeper.look(false, false, later + Duration::from_secs(6)),
            "a retry waits out the gap from this series, not the first launch"
        );
    }

    #[test]
    fn a_tom_open_beyond_reach_fails_at_once_and_a_retry_waits_its_turn() {
        let mut keeper = Keeper::default();
        let start = Instant::now();
        assert!(keeper.look(false, false, start));
        keeper.launch_failed(tom_link::ALREADY_OPEN.into());
        assert_eq!(keeper.failed.as_deref(), Some(tom_link::ALREADY_OPEN));
        keeper.retry();
        assert_eq!(keeper.phase(), Phase::Reopening);
        assert!(
            !keeper.look(false, false, start + Duration::from_secs(1)),
            "too soon"
        );
        keeper.retry();
        assert!(
            keeper.look(false, false, start + RETRY_GAP),
            "a retry mid-series changes nothing"
        );
    }

    #[test]
    fn saves_once_a_run_of_taken_results_has_settled_and_never_without_one() {
        let mut watch = Watch::default();
        let start = Instant::now();
        assert_eq!(watch.save_due(start + SAVE_AFTER), None, "nothing taken");
        let owed = Unsaved {
            at: start,
            name: Some("Spring Cup".to_owned()),
            id: Some("26-10-000001".to_owned()),
            tries: 0,
        };
        watch.unsaved = Some(owed.clone());
        assert_eq!(
            watch.save_due(start + Duration::from_secs(1)),
            None,
            "the run goes on"
        );
        assert_eq!(watch.save_due(start + SAVE_AFTER), Some(owed));
        assert_eq!(watch.save_due(start + SAVE_AFTER * 2), None, "saved once");
    }

    #[test]
    fn a_save_tom_could_not_make_is_tried_a_few_more_times() {
        let mut watch = Watch::default();
        let start = Instant::now();
        let mut owed = Unsaved {
            at: start,
            name: None,
            id: None,
            tries: 0,
        };
        for _ in 1..SAVE_TRIES {
            watch.save_failed(owed, start);
            owed = watch.save_due(start + SAVE_AFTER).expect("tried again");
        }
        watch.save_failed(owed, start);
        assert_eq!(watch.unsaved, None, "left to TOM's auto-save");
    }

    #[test]
    fn a_save_older_than_the_last_read_is_another_source() {
        let dir = std::env::temp_dir().join(format!("tom-older-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cup = dir.join("Cup.tdf");
        std::fs::write(&cup, "<tournament round=\"4\"/>").unwrap();
        let mut watch = Watch::default();
        let mut live = read_tdf(&cup, None).unwrap();
        live.stamp.0 = 2_000;
        live.modified = 2_000;
        watch.take(live);
        // Last night's backup copied over the same path keeps its older time.
        let mut backup = read_tdf(&cup, None).unwrap();
        backup.modified = 1_000;
        watch.take(backup);
        assert_eq!(
            watch.source, 2,
            "the site starts over, and checks it for being older"
        );
        assert_eq!(watch.file.as_ref().map(|file| file.modified), Some(1_000));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn forgets_a_file_tom_no_longer_has_open() {
        let dir = std::env::temp_dir().join(format!("tom-forget-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cup = dir.join("Cup.tdf");
        std::fs::write(&cup, "<tournament/>").unwrap();
        let mut watch = Watch::default();
        watch.take(read_tdf(&cup, None).unwrap());
        watch.forget_unless(Some(&cup));
        assert!(watch.file.is_some(), "still TOM's file");
        watch.forget_unless(Some(&dir.join("New.tdf")));
        assert!(
            watch.file.is_none(),
            "TOM moved to another file, unread yet"
        );
        watch.take(read_tdf(&cup, None).unwrap());
        std::fs::remove_file(&cup).unwrap();
        watch.forget_unless(Some(&cup));
        assert!(watch.file.is_none(), "the file is gone");
        assert_eq!(watch.source, 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn follows_only_a_tdf_and_each_save_of_it() {
        let dir = std::env::temp_dir().join(format!("tom-follow-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let tdf = dir.join("Cup.tdf");
        let other = dir.join("notes.txt");
        std::fs::write(&tdf, "<tournament/>").unwrap();
        std::fs::write(&other, "secret").unwrap();
        assert!(read_tdf(&other, None).is_none(), "only a .tdf is ever read");
        let mut watch = Watch::default();
        watch.take(read_tdf(&tdf, None).unwrap());
        let first = watch.file.clone().unwrap();
        assert_eq!(first.text.as_deref(), Some("<tournament/>"));
        assert!(
            read_tdf(&tdf, Some(first.stamp)).is_none(),
            "unchanged, unread"
        );
        assert_eq!(
            watch.name(1).as_deref(),
            Some("Cup.tdf"),
            "named by the app"
        );
        assert!(watch.read(0, 1).is_some());
        assert!(
            watch.read(first.modified, 1).is_none(),
            "still the read the site has"
        );
        assert!(
            watch.read(0, 2).is_none() && watch.name(2).is_none(),
            "never another file's"
        );
        // The same millisecond, another length: still a new save, and later.
        std::fs::write(&tdf, "<tournament saved=\"again\"/>").unwrap();
        let mut again = read_tdf(&tdf, Some(first.stamp)).unwrap();
        again.modified = first.modified;
        watch.take(again);
        let second = watch.file.clone().unwrap();
        assert_eq!(
            second.text.as_deref(),
            Some("<tournament saved=\"again\"/>")
        );
        assert!(second.modified > first.modified);
        assert_eq!(watch.source, 1, "the same file");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn turning_off_stops_even_when_it_cannot_be_saved() {
        let unwritable = std::env::temp_dir().join(format!("tom-config-{}", std::process::id()));
        std::fs::write(&unwritable, "a file, not a folder").unwrap();
        let shared = Shared {
            bridge: Mutex::new(Bridge::new(None)),
            config: Some(unwritable.join("tom.json")),
            helper_jar: Path::new("tom-bridge.jar").to_path_buf(),
            on: AtomicBool::new(true),
            watch: Mutex::default(),
            looking: AtomicBool::new(false),
            asking: AtomicBool::new(false),
        };
        let bridge = Bridge::new(None);
        locked(&shared.watch).source = 3;
        assert!(
            shared.switch(&bridge, false).is_err(),
            "says it was not saved"
        );
        assert_eq!(locked(&shared.watch).source, 3, "the source only grows");
        assert!(!shared.on(), "but stops");
        assert!(shared.switch(&bridge, true).is_err());
        assert!(!shared.on(), "and does not go on unsaved");
        assert_eq!(shared.refusal(None), Some(super::OFF));
        shared.on.store(true, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(
            shared.refusal(Some(3)),
            None,
            "still the file the event was matched to"
        );
        assert_eq!(
            shared.refusal(Some(2)),
            Some(super::MOVED),
            "TOM has since opened another"
        );
        assert_eq!(
            shared.refusal(None),
            None,
            "an event with a sanction ID names no file"
        );
        std::fs::remove_file(unwritable).unwrap();
    }

    /// The release build serves the app's own page from disk: a site address
    /// there would make Tauri take the live site as the app's own page, whose
    /// IPC the site's remote-only capability does not cover.
    #[test]
    fn the_site_stays_remote_to_the_app() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let dist = config["build"]["frontendDist"].as_str().unwrap();
        assert!(!dist.contains("://"), "frontendDist is {dist}");
        let site: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/site.json")).unwrap();
        assert_eq!(site["local"], false);
        assert_eq!(
            site["remote"]["urls"][0],
            "https://events.ciphermaniac.com/*"
        );
    }
}
