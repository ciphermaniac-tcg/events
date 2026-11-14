//! Tauri commands for TOM, the tournament software these results go into.
//! Desktop only; the local panel in the "tom" window calls them.
//!
//! Commands and what they return (JSON as the webview receives it):
//!
//! - `tom_detect()` -> `string[]`: TOM programs found in the usual install folders.
//! - `tom_set_path(path)` -> `string`: the TOM program `path` resolves to (an
//!   `.app`, an install folder or the program itself), saved for next time.
//!   Rejects with a sentence when there is no TOM there.
//! - `tom_launch()` -> `Status`: starts TOM with the helper loaded, finding it
//!   first when no path is saved. Rejects with a sentence when it cannot.
//! - `tom_status()` -> `Status`.
//! - `tom_get_mode()` -> `"inside" | "keys"`.
//! - `tom_set_mode(mode)` -> `"inside" | "keys"`, saved for next time.
//! - `tom_submit(entries: Entry[])` -> `SubmitResult[]`, one per entry, in order.
//!   Each code must spell exactly its entry's layout (and never table 0) or it
//!   is rejected unsent. The batch stops at the first entry that is not
//!   accepted: every later one comes back `not_ready`, unsent.
//!   In inside mode, a pod's paired round is started first when needed.
//! - `tom_save()` -> `SaveResult`.
//! - `tom_start_round(pod?: number)` -> `StartResult`. `pod` is TOM's category
//!   code (0 Juniors, 1 Seniors, 2 Masters, 8 Juniors and Seniors, 9 Seniors
//!   and Masters, 10 everyone); leave it out when the event has one pod.
//!
//! ```text
//! Entry = {                        // computed from the .tdf TOM saved
//!   pod: number,                   // category code: 0, 1, 2, 8, 9, 10
//!   flight?: number,               // only for a flighted pod in a Swiss round
//!   round: number,                 // as TOM numbers it (top cut keeps counting)
//!   table: number,                 // never 0
//!   outcome: number,               // 0 pending, 1 P1 wins, 2 P2 wins, 3 tie, 6 double loss
//!   code: string                   // the slip code those parts make
//! }
//! Status = {
//!   mode: "inside" | "keys",
//!   tomPath: string | null,        // the TOM program that tom_launch starts
//!   launched: boolean,             // TOM is running as this app's child
//!   ready: boolean,                // a submit would be attempted now
//!   reason: string | null,         // why not, when ready is false
//!   tournamentOpen: boolean,
//!   slipDialogOpen: boolean,       // Speed Match Slip Entry is open
//!   windows: string[],             // titles of TOM's open windows
//!   pods: { category?: number, round: number, started: boolean }[]
//!                                  // inside mode only; [] in keys mode
//! }
//! SubmitResult =
//!   | { result: "accepted", code: string }
//!   | { result: "rejected", code: string, message: string }  // TOM's Error text, or the code check's
//!   | { result: "not_ready", code: string, reason: string }  // not sent; includes any TOM Error text
//!   | { result: "uncertain", code: string, reason: string }  // may have reached TOM; check TOM before resending
//! SaveResult = { result: "saved" } | { result: "not_ready", reason: string }
//! StartResult =
//!   | { result: "started" }
//!   | { result: "already_started" }                         // also a success
//!   | { result: "not_ready", reason: string }
//! ```

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};
use tom_link::{Bridge, Entry, Mode, SaveResult, StartResult, Status, SubmitResult};

const CONFIG_FILE: &str = "tom.json";
const HELPER_JAR: &str = "resources/tom-bridge.jar";

/// What survives a restart.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    #[serde(default)]
    mode: Mode,
    #[serde(default)]
    tom_path: Option<PathBuf>,
}

/// The bridge plus where its settings live; commands share it across threads.
pub struct Tom(Arc<Shared>);

struct Shared {
    bridge: Mutex<Bridge>,
    config: Option<PathBuf>,
    helper_jar: PathBuf,
}

impl Tom {
    pub fn new(app: &AppHandle) -> Self {
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
        Self(Arc::new(Shared {
            bridge: Mutex::new(Bridge::new(saved.mode, saved.tom_path)),
            config,
            helper_jar: helper_jar(app),
        }))
    }

    /// Runs bridge work off the async runtime and the main thread: TOM can
    /// take seconds per code, and requests to it run one at a time.
    async fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce(&Shared, &mut Bridge) -> T + Send + 'static,
    ) -> Result<T, String> {
        let shared = Arc::clone(&self.0);
        tauri::async_runtime::spawn_blocking(move || {
            let mut bridge = shared.bridge.lock().unwrap_or_else(PoisonError::into_inner);
            work(&shared, &mut bridge)
        })
        .await
        .map_err(|error| format!("The TOM bridge failed: {error}"))
    }
}

impl Shared {
    fn save_config(&self, bridge: &Bridge) -> Result<(), String> {
        let Some(path) = &self.config else {
            return Err("This app has no settings folder.".into());
        };
        let saved = Saved {
            mode: bridge.mode(),
            tom_path: bridge.tom_path().map(Path::to_path_buf),
        };
        let text = serde_json::to_string_pretty(&saved).map_err(|error| error.to_string())?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)
                .map_err(|error| format!("Settings could not be saved: {error}"))?;
        }
        fs::write(path, text).map_err(|error| format!("Settings could not be saved: {error}"))
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

#[tauri::command]
pub async fn tom_detect() -> Result<Vec<String>, String> {
    let found = tauri::async_runtime::spawn_blocking(tom_link::detect)
        .await
        .map_err(|error| error.to_string())?;
    Ok(found
        .iter()
        .map(|path| path.display().to_string())
        .collect())
}

#[tauri::command]
pub async fn tom_set_path(tom: State<'_, Tom>, path: String) -> Result<String, String> {
    tom.run(move |shared, bridge| {
        let program = bridge.set_tom_path(Path::new(&path))?;
        shared.save_config(bridge)?;
        Ok(program.display().to_string())
    })
    .await?
}

#[tauri::command]
pub async fn tom_launch(tom: State<'_, Tom>) -> Result<Status, String> {
    tom.run(|shared, bridge| {
        bridge.launch(&shared.helper_jar)?;
        shared.save_config(bridge)?;
        Ok(bridge.status())
    })
    .await?
}

#[tauri::command]
pub async fn tom_status(tom: State<'_, Tom>) -> Result<Status, String> {
    tom.run(|_, bridge| bridge.status()).await
}

#[tauri::command]
pub async fn tom_get_mode(tom: State<'_, Tom>) -> Result<Mode, String> {
    tom.run(|_, bridge| bridge.mode()).await
}

#[tauri::command]
pub async fn tom_set_mode(tom: State<'_, Tom>, mode: Mode) -> Result<Mode, String> {
    tom.run(move |shared, bridge| {
        bridge.set_mode(mode);
        shared.save_config(bridge).map(|()| mode)
    })
    .await?
}

#[tauri::command]
pub async fn tom_submit(
    tom: State<'_, Tom>,
    entries: Vec<Entry>,
) -> Result<Vec<SubmitResult>, String> {
    tom.run(move |_, bridge| bridge.submit(&entries)).await
}

#[tauri::command]
pub async fn tom_save(tom: State<'_, Tom>) -> Result<SaveResult, String> {
    tom.run(|_, bridge| bridge.save()).await
}

#[tauri::command]
pub async fn tom_start_round(tom: State<'_, Tom>, pod: Option<u8>) -> Result<StartResult, String> {
    tom.run(move |_, bridge| bridge.start_round(pod)).await
}
