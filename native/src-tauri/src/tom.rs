//! Tauri commands for TOM, the tournament software these results go into.
//! Desktop only; the local panel in the "tom" window calls them.
//!
//! TOM is optional: events the site runs itself never touch it. The app
//! opens only the site; the panel opens from the menu ("TOM Link…") or when
//! a TOM-run event's console asks (`tom_open_panel`), and the bridge state
//! is built on the first TOM command, not at launch.
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
//! - `tom_open_panel()` -> `null`: shows the TOM panel, opening it if needed.
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
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, Wry};
use tom_link::{Bridge, Entry, Mode, SaveResult, StartResult, Status, SubmitResult};

const CONFIG_FILE: &str = "tom.json";
const HELPER_JAR: &str = "resources/tom-bridge.jar";
const PANEL_WINDOW: &str = "tom";
const OPEN_PANEL: &str = "tom-open-panel";

/// What survives a restart.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    #[serde(default)]
    mode: Mode,
    #[serde(default)]
    tom_path: Option<PathBuf>,
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
        work: impl FnOnce(&Shared, &mut Bridge) -> T + Send + 'static,
    ) -> Result<T, String> {
        let shared = self.shared();
        tauri::async_runtime::spawn_blocking(move || {
            let mut bridge = shared.bridge.lock().unwrap_or_else(PoisonError::into_inner);
            work(&shared, &mut bridge)
        })
        .await
        .map_err(|error| format!("The TOM bridge failed: {error}"))
    }
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
            bridge: Mutex::new(Bridge::new(saved.mode, saved.tom_path)),
            config,
            helper_jar: helper_jar(app),
        }
    }

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

#[tauri::command]
pub async fn tom_open_panel(app: AppHandle) -> Result<(), String> {
    open_panel(&app).map_err(|error| error.to_string())
}

/// Readies TOM without touching it: the state the commands use, built on
/// first use, and the menu item that opens the panel.
pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    app.manage(Tom::new(app.handle()));
    app.set_menu(menu(app.handle())?)?;
    app.on_menu_event(|app, event| {
        if event.id() == OPEN_PANEL
            && let Err(error) = open_panel(app)
        {
            log::warn!("the TOM panel could not open: {error}");
        }
    });
    Ok(())
}

/// Shows the TOM panel, opening it the first time.
fn open_panel(app: &AppHandle) -> tauri::Result<()> {
    if let Some(panel) = app.get_webview_window(PANEL_WINDOW) {
        panel.unminimize()?;
        panel.show()?;
        return panel.set_focus();
    }
    WebviewWindowBuilder::new(app, PANEL_WINDOW, WebviewUrl::App("index.html".into()))
        .title("TOM Link")
        .inner_size(480.0, 720.0)
        .build()
        .map(drop)
}

/// The platform's usual menu with "TOM Link…" in the app menu on macOS and
/// in the Window menu elsewhere.
fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    let item = MenuItem::with_id(app, OPEN_PANEL, "TOM Link…", true, None::<&str>)?;
    let submenus: Vec<Submenu<Wry>> = menu
        .items()?
        .iter()
        .filter_map(|entry| entry.as_submenu().cloned())
        .collect();
    if cfg!(target_os = "macos")
        && let Some(app_menu) = submenus.first()
    {
        app_menu.insert(&item, 1)?;
    } else if let Some(window) = submenus
        .iter()
        .find(|submenu| submenu.text().is_ok_and(|text| text == "Window"))
    {
        window.append(&item)?;
    } else {
        menu.append(&Submenu::with_items(app, "TOM", true, &[&item])?)?;
    }
    Ok(menu)
}
