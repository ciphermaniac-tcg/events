//! A test build's Try menu: the app chrome round's options, switched in the
//! running app so they can be judged on a real Mac. Each group is one choice
//! kept in `<app_data>/try.json`. The page side is one stylesheet keyed on
//! `data-try-<group>` attributes on the root, so a choice is a change of
//! attribute: live for everything the page draws, and a relaunch for the
//! title bar, whose buttons the window places only when it is made.

use std::{collections::BTreeMap, fs, path::PathBuf, sync::Mutex};

use tauri::{
    AppHandle, Manager, Runtime, WebviewWindowBuilder,
    menu::{CheckMenuItem, CheckMenuItemBuilder, MenuItemBuilder, Submenu, SubmenuBuilder},
};

use crate::shell;

/// One choice: its menu label and the value its attribute takes.
struct Choice {
    value: &'static str,
    label: &'static str,
}

/// A group of choices, the first being today's app.
struct Group {
    key: &'static str,
    label: &'static str,
    /// Whether the window has to be made again for it to show.
    relaunch: bool,
    choices: &'static [Choice],
}

const fn choice(value: &'static str, label: &'static str) -> Choice {
    Choice { value, label }
}

const GROUPS: &[Group] = &[
    Group {
        key: "bar",
        label: "Title Bar",
        relaunch: true,
        choices: &[
            choice("separate", "Separate Title Bar (Today)"),
            choice("one", "One Bar: the Head Bar Is the Title Bar"),
            choice("none", "No Head Bar: Account at the Top Right"),
        ],
    },
    Group {
        key: "height",
        label: "Bar Height",
        relaunch: true,
        choices: &[
            choice("44", "44 px (Today)"),
            choice("38", "38 px, Compact"),
            choice("40", "40 px"),
            choice("52", "52 px, Unified Toolbar"),
        ],
    },
    Group {
        key: "color",
        label: "Bar Color",
        relaunch: false,
        choices: &[
            choice("dark", "Near-Black (Today)"),
            choice("window", "The Window's Color"),
        ],
    },
    Group {
        key: "font",
        label: "Font",
        relaunch: false,
        choices: &[
            choice("inter", "Inter (Today)"),
            choice("system", "SF Pro, the System Font"),
            choice("rounded", "SF Pro Rounded"),
            choice("avenir", "Avenir Next"),
            choice("helvetica", "Helvetica Neue"),
            choice("newyork", "New York Headings, SF Pro Text"),
        ],
    },
    Group {
        key: "chrome",
        label: "Chrome Font",
        relaunch: false,
        choices: &[
            choice("site", "Same as the Page (Today)"),
            choice("system", "SF Pro for Bars, Tabs, Buttons and Menus"),
        ],
    },
    Group {
        key: "footer",
        label: "Footer",
        relaunch: false,
        choices: &[
            choice("shown", "Shown (Today)"),
            choice("hidden", "Hidden in the App"),
        ],
    },
    Group {
        key: "appearance",
        label: "Appearance",
        relaunch: false,
        choices: &[
            choice("system", "Match the System"),
            choice("light", "Light"),
            choice("dark", "Dark"),
        ],
    },
    Group {
        key: "sheets",
        label: "Where Confirmations and Editors Open",
        relaunch: false,
        choices: &[
            choice(
                "site",
                "Middle of the Window, Player Sheet at the Side (Today)",
            ),
            choice("attached", "Attached Under the Bar"),
            choice("float", "Floating Below the Bar"),
        ],
    },
    Group {
        key: "press",
        label: "How a Button Looks While Held Down",
        relaunch: false,
        choices: &[
            choice("site", "Shrinks Slightly (Today)"),
            choice("fadeshrink", "Fades and Shrinks Slightly"),
            choice("tint", "Darkens, Size Unchanged"),
            choice("dim", "Fades, Size Unchanged"),
        ],
    },
];

const RESET: &str = "try:reset";

/// The samples of the site's dialogs, by menu id and the kind the demo
/// script takes.
const DEMOS: &[(&str, &str, &str)] = &[
    ("try-demo:confirm", "confirm", "Show a Sample Confirmation"),
    ("try-demo:editor", "editor", "Show a Sample Editor"),
    ("try-demo:sheet", "sheet", "Show a Sample Player Sheet"),
];

/// The site's own rules for its dialogs and player sheet
/// (src/styles/pages/tournament.css and tournament-sheet.css), for a page
/// that has not loaded them yet.
const DEMO_STYLE: &str = r"
.tm-modal { width: min(480px, calc(100vw - 32px)); padding: 0; text-align: start; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-float); color: var(--fg); }
.tm-modal::backdrop { background: var(--scrim); }
.tm-box-bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); padding: 10px 14px; border-bottom: 1px solid var(--rule); font-size: var(--text-base); }
.tm-box-bar:last-child { border-bottom: 0; }
.tm-modal .tm-box-bar { padding: var(--space-3) var(--space-4); }
.tm-modal h3 { margin: 0; font-size: var(--text-base); }
.tm-modal-foot { justify-content: flex-end; }
.tm-modal .tm-modal-body { display: grid; gap: var(--space-3); }
.tm-modal .tm-box-bar + .tm-box-bar { border-top: 0; }
.tm-modal .tm-box-bar.tm-modal-foot { position: sticky; bottom: 0; margin-top: -1px; border-top: 1px solid var(--rule); background: var(--surface); }
.tm-field { display: grid; gap: var(--space-2); min-width: 0; }
.tm-label { font-size: var(--text-base); font-weight: 600; }
.tm-input { width: 100%; min-height: var(--control-h); font: inherit; font-size: var(--text-base); color: var(--fg); background: var(--field); border: var(--border-width) solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2) 10px; }
.tm-scrim { position: fixed; inset: 0; z-index: 60; background: var(--scrim); }
.tm-sheet { position: fixed; top: 0; right: 0; bottom: 0; z-index: 61; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; width: min(440px, 100vw); background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--shadow-float); }
.tm-sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); margin: 0 var(--space-4); padding: var(--space-4) 0 var(--space-3); border-bottom: 1px solid var(--rule); }
.tm-sheet-head h2 { margin: 0; font-size: var(--text-xl); }
.tm-sheet-head p { margin: 2px 0 0; font-size: var(--text-base); }
.tm-sheet-body { display: grid; align-content: start; gap: var(--space-3); overflow-y: auto; padding: var(--space-4); }
.tm-sheet-foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--rule); }
";

const CONFIRM_DEMO: &str = r#"<dialog class="tm-modal tm-confirm-dialog try-demo" aria-label="Drop Sam Rivera?">
<div class="tm-box-bar"><h3>Drop Sam Rivera?</h3></div>
<div class="tm-box-bar tm-modal-body"><p>They leave the event after this round. Their results so far stay in the standings.</p></div>
<div class="tm-box-bar tm-modal-foot"><button type="button" class="btn btn-ghost" data-close>Keep</button><button type="button" class="btn btn-secondary tm-danger" data-close>Drop player</button></div>
</dialog>"#;

const EDITOR_DEMO: &str = r#"<dialog class="tm-modal tm-edit-player try-demo" aria-label="Edit player">
<div class="tm-box-bar"><h3>Edit player</h3></div>
<div class="tm-box-bar tm-modal-body">
<div class="tm-field"><label class="tm-label" for="try-first">First name</label><input id="try-first" class="tm-input" value="Sam"></div>
<div class="tm-field"><label class="tm-label" for="try-last">Last name</label><input id="try-last" class="tm-input" value="Rivera"></div>
</div>
<div class="tm-box-bar tm-modal-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="button" class="btn btn-primary" data-close>Save</button></div>
</dialog>"#;

const SHEET_DEMO: &str = r#"<div class="tm-sheet try-demo" role="dialog" aria-modal="true" aria-labelledby="try-sheet-title">
<div class="tm-sheet-head"><div><h2 id="try-sheet-title">Sam Rivera</h2><p class="muted">3–1, table 4</p></div><button type="button" class="btn btn-ghost" data-close>Close</button></div>
<div class="tm-sheet-body"><p>Round 1: won against Jordan Lee</p><p>Round 2: won against Priya Shah</p><p>Round 3: lost to Alex Kim</p><p>Round 4: won against Morgan Diaz</p></div>
<div class="tm-sheet-foot"><button type="button" class="btn btn-secondary" data-close>Edit player</button></div>
</div>"#;

/// Opens a sample of one of the site's dialogs over the page, closed by its
/// buttons, Escape or (for the sheet) a click beside it.
fn demo_script(kind: &str) -> String {
    let html = match kind {
        "confirm" => CONFIRM_DEMO,
        "editor" => EDITOR_DEMO,
        _ => SHEET_DEMO,
    };
    let html = serde_json::Value::from(html);
    let style = serde_json::Value::from(DEMO_STYLE);
    format!(
        "(() => {{ document.querySelectorAll('.try-demo').forEach(node => node.remove()); \
         if (!document.getElementById('try-demo-style')) {{ const style = document.createElement('style'); \
         style.id = 'try-demo-style'; style.textContent = {style}; document.head.prepend(style); }} \
         const template = document.createElement('template'); template.innerHTML = {html}; \
         const box = template.content.firstElementChild; \
         if (box.tagName === 'DIALOG') {{ box.addEventListener('close', () => box.remove()); \
         box.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => box.close())); \
         document.body.append(box); box.showModal(); return; }} \
         const scrim = document.createElement('div'); scrim.className = 'tm-scrim try-demo'; \
         const close = () => {{ scrim.remove(); box.remove(); document.removeEventListener('keydown', onKey); }}; \
         const onKey = event => {{ if (event.key === 'Escape') close(); }}; \
         scrim.addEventListener('click', close); \
         box.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close)); \
         document.addEventListener('keydown', onKey); document.body.append(scrim, box); }})();"
    )
}

fn show_demo(app: &AppHandle<tauri::Wry>, kind: &str) {
    if let Some(window) = app.get_webview_window(shell::MAIN_WINDOW)
        && let Err(err) = window.eval(demo_script(kind))
    {
        log::debug!("could not show the sample: {err}");
    }
}
const FILE: &str = "try.json";

/// The choices made, by group; a group not in it is at today's.
type Choices = BTreeMap<String, String>;

fn group_of(key: &str) -> Option<&'static Group> {
    GROUPS.iter().find(|group| group.key == key)
}

/// The value `choices` holds for `key`, today's when it holds none or one
/// no longer offered.
fn chosen<'a>(choices: &'a Choices, key: &str) -> &'a str {
    let Some(group) = group_of(key) else {
        return "";
    };
    choices
        .get(key)
        .map(String::as_str)
        .filter(|value| group.choices.iter().any(|choice| choice.value == *value))
        .unwrap_or(group.choices[0].value)
}

fn menu_id(key: &str, value: &str) -> String {
    format!("try:{key}:{value}")
}

/// The group and value a menu id names.
fn parse_id(id: &str) -> Option<(&'static Group, &str)> {
    let (key, value) = id.strip_prefix("try:")?.split_once(':')?;
    let group = group_of(key)?;
    group
        .choices
        .iter()
        .any(|choice| choice.value == value)
        .then_some((group, value))
}

fn file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join(FILE))
}

/// The choices kept from last time.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Choices {
    file(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save<R: Runtime>(app: &AppHandle<R>, choices: &Choices) {
    let Some(path) = file(app) else {
        return;
    };
    let written = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(&path, serde_json::to_string(choices).unwrap_or_default()));
    if let Err(err) = written {
        log::warn!("could not keep the Try choices: {err}");
    }
}

/// The attributes for `choices`, every group named.
fn attributes(choices: &Choices) -> BTreeMap<&'static str, String> {
    GROUPS
        .iter()
        .map(|group| (group.key, chosen(choices, group.key).to_owned()))
        .collect()
}

/// A window button's size, and how far the window's buttons land from the
/// inset asked for: measured on macOS 15, an inset of (12, 9) put the close
/// button 11 pt from the left and 3 pt from the top.
const BUTTON: u32 = 16;
#[cfg(any(target_os = "macos", test))]
const BUTTON_RISE: u32 = 6;
#[cfg(any(target_os = "macos", test))]
const BUTTON_SHIFT: u32 = 1;

/// The space above and below a window button centered in a bar of `height`.
fn button_margin(height: u32) -> u32 {
    height.saturating_sub(BUTTON) / 2
}

/// How far the close button sits from the window's left edge: a little more
/// than above it, as `AppKit` places it in its own toolbars (20 pt in a 52 pt
/// one, 18 above).
fn lights_left(height: u32) -> u32 {
    button_margin(height) + 2
}

/// The inset that puts the window's buttons there, centered in the bar.
#[cfg(any(target_os = "macos", test))]
fn traffic_lights(height: u32) -> (f64, f64) {
    (
        f64::from(lights_left(height) + BUTTON_SHIFT),
        f64::from(button_margin(height) + BUTTON_RISE),
    )
}

/// The bar's height: the one chosen, or with no head bar the strip the
/// window's buttons and the account sit in.
fn bar_height(choices: &Choices) -> u32 {
    if chosen(choices, "bar") == "none" {
        return NO_BAR_HEIGHT;
    }
    chosen(choices, "height").parse().unwrap_or(44)
}

const NO_BAR_HEIGHT: u32 = 32;

/// The room the head bar leaves at its left for the window's buttons: the
/// three buttons, 20 pt apart, and after them a gap a little wider than the
/// space above them.
fn lights_room(height: u32) -> u32 {
    lights_left(height) + 2 * 20 + BUTTON + button_margin(height) + 6
}

/// The page's stylesheet. Every rule waits for its attribute, so with none
/// set the site is as it is today.
const STYLE: &str = r#"
:root[data-try-height="38"]:not([data-try-bar="none"]), :root[data-try-height="38"]:not([data-try-bar="none"]) body[data-mode] { --topnav-h: 38px !important; }
:root[data-try-height="40"]:not([data-try-bar="none"]), :root[data-try-height="40"]:not([data-try-bar="none"]) body[data-mode] { --topnav-h: 40px !important; }
:root[data-try-height="52"]:not([data-try-bar="none"]), :root[data-try-height="52"]:not([data-try-bar="none"]) body[data-mode] { --topnav-h: 52px !important; }
:root[data-try-height="38"] .site-head-name, :root[data-try-height="38"] .site-head-name small { font-size: 13px; }
:root[data-try-height="38"] .site-head-name img { width: 16px; height: 19px; }
:root[data-try-height="38"] .site-head .tm-acct-button { width: 24px; height: 24px; font-size: 11px; }
:root[data-try-height="38"] .site-head-signin { min-height: 24px; height: 24px; font-size: 12px; }

:root[data-try-bar="one"] .site-head-row { max-width: none; padding-left: var(--try-lights, 92px); padding-right: var(--try-edge, 16px); }
:root[data-try-bar="one"] .site-head { -webkit-user-select: none; user-select: none; }

:root:is([data-try-color="window"], [data-try-bar="none"]) .site-head.head-bar {
  --bg: inherit; --surface: inherit; --surface-2: inherit; --field: inherit; --border: inherit;
  --rule: inherit; --fg: inherit; --muted: inherit; --negative: inherit; --accent: inherit;
  --accent-hover: inherit; --accent-ink: inherit; --accent-ink-hover: inherit; --accent-fill: inherit;
  --accent-fill-hover: inherit; --positive: inherit; --warning: inherit; --zebra: inherit;
  --row-hover: inherit; --segment-on: inherit; --focus-color: inherit; --focus-ring: inherit;
  color-scheme: inherit; border-bottom-color: var(--rule);
}

:root[data-try-font="system"] :is(body, h1, h2, h3, h4, h5, h6) { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important; }
:root[data-try-font="rounded"] :is(body, h1, h2, h3, h4, h5, h6) { font-family: ui-rounded, 'SF Pro Rounded', -apple-system, system-ui, sans-serif !important; }
:root[data-try-font="avenir"] :is(body, h1, h2, h3, h4, h5, h6) { font-family: 'Avenir Next', Avenir, system-ui, sans-serif !important; }
:root[data-try-font="helvetica"] :is(body, h1, h2, h3, h4, h5, h6) { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important; }
:root[data-try-font="newyork"] body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important; }
:root[data-try-font="newyork"] :is(h1, h2, h3, h4, h5, h6) { font-family: ui-serif, 'New York', Georgia, serif !important; letter-spacing: 0 !important; }
:root:not([data-try-font="inter"]) body { font-feature-settings: normal; }

:root[data-try-chrome="system"] :is(.site-head, .site-head *, .tabs, .tabs *, [role="tablist"], [role="tablist"] *, .tm-tabbar, .tm-tabbar *, .btn, button, [role="menu"], [role="menu"] *, .tm-box-bar h3, .tm-sheet-head h2) {
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important; font-feature-settings: normal; letter-spacing: 0 !important;
}

:root[data-try-footer="hidden"] .site-footer { display: none !important; }

:root[data-try-bar="none"], :root[data-try-bar="none"] body[data-mode] { --topnav-h: 32px !important; }
:root[data-try-bar="none"] .site-head.head-bar { border-bottom: 0; }
:root[data-try-bar="none"] .site-head-name { display: none; }
:root[data-try-bar="none"] .site-head-row { max-width: none; justify-content: flex-end; padding: 0 var(--try-edge, 10px) 0 var(--try-lights, 78px); }
:root[data-try-bar="none"] .site-head .tm-acct-button { width: 22px; height: 22px; font-size: 10px; }
:root[data-try-bar="none"] .site-head-signin { min-height: 22px; height: 22px; font-size: 12px; }

@keyframes try-drop { from { transform: translateY(-14px); opacity: 0; } }
:root[data-try-sheets="attached"] dialog.tm-modal[open] { margin: var(--topnav-h) auto auto; border-top: 0; border-radius: 0 0 10px 10px; animation: try-drop 180ms ease-out; }
:root[data-try-sheets="float"] dialog.tm-modal[open] { margin: calc(var(--topnav-h) + 10px) auto auto; border-radius: 10px; animation: try-drop 180ms ease-out; }
:root:is([data-try-sheets="attached"], [data-try-sheets="float"]) dialog.tm-modal::backdrop { background: rgba(0, 0, 0, 0.18); }
@media (min-width: 641px) {
  :root:is([data-try-sheets="attached"], [data-try-sheets="float"]) .tm-scrim { top: var(--topnav-h); background: rgba(0, 0, 0, 0.18); }
  :root:is([data-try-sheets="attached"], [data-try-sheets="float"]) .tm-sheet {
    top: var(--topnav-h); bottom: auto; left: 50%; right: auto; translate: -50% 0;
    width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - var(--topnav-h) - 40px);
    border: 1px solid var(--border); animation: try-drop 180ms ease-out;
  }
  :root[data-try-sheets="attached"] .tm-sheet { border-top: 0; border-radius: 0 0 10px 10px; }
  :root[data-try-sheets="float"] .tm-sheet { top: calc(var(--topnav-h) + 10px); border-radius: 10px; }
}

:root[data-try-press="tint"] :is(button, .btn, [role="tab"], [role="menuitem"], .chip):active:not(:disabled) {
  box-shadow: inset 0 0 0 100vmax color-mix(in srgb, currentColor 12%, transparent) !important; transform: none !important;
}
:root[data-try-press="fadeshrink"] :is(button, .btn, [role="tab"], [role="menuitem"], .chip):active:not(:disabled) {
  opacity: 0.7; transition-duration: 60ms;
}
:root[data-try-press="dim"] :is(button, .btn, [role="tab"], [role="menuitem"], .chip):active:not(:disabled) {
  opacity: 0.55 !important; transform: none !important; transition: none !important;
}
"#;

/// Sets the root's attributes from `choices` (a JSON object) and keeps them
/// for the page's next load in this run.
const APPLY: &str = "window.__cmTry = choices => { const root = document.documentElement; \
     for (const [key, value] of Object.entries(choices)) root.setAttribute('data-try-' + key, value); \
     try { localStorage.setItem('cm-try', JSON.stringify(choices)); } catch {} \
     window.__cmTryMode(choices.appearance); };";

/// Sets the site's light or dark mode as the site's footer switch does
/// (`cm:mode` in src/lib/theme.ts): stored for a mode picked, cleared to
/// follow the system.
const MODE: &str = "window.__cmTryMode = appearance => { \
     try { if (appearance === 'system') localStorage.removeItem('cm:mode'); \
     else localStorage.setItem('cm:mode', appearance); } catch {} \
     const paint = () => { document.body.dataset.mode = appearance === 'system' \
     ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance; }; \
     if (document.body) paint(); else document.addEventListener('DOMContentLoaded', paint, { once: true }); };";

/// Moves the window by the head bar when it is the title bar, and zooms it
/// on a double click, as a title bar does; its links and buttons stay
/// theirs.
const DRAG: &str = "document.addEventListener('mousedown', event => { \
     if (event.button !== 0 || !['one', 'none'].includes(document.documentElement.dataset.tryBar)) return; \
     const target = event.target; if (!(target instanceof Element) || !target.closest('.site-head')) return; \
     if (target.closest('a, button, input, select, textarea, [role]')) return; \
     event.preventDefault(); const invoke = window.__TAURI_INTERNALS__.invoke; \
     invoke(event.detail === 2 ? 'plugin:window|internal_toggle_maximize' : 'plugin:window|start_dragging').catch(() => {}); });";

/// The script each page of the main window runs first: the stylesheet, the
/// choices (this run's latest, else the ones it launched with), and the
/// bar's dragging.
pub fn script<R: Runtime>(app: &AppHandle<R>) -> String {
    let choices = load(app);
    let launched = serde_json::to_string(&attributes(&choices)).unwrap_or_default();
    let style = serde_json::Value::from(STYLE);
    let height = bar_height(&choices);
    let room = lights_room(height);
    let edge = lights_left(height);
    let site = shell::SITE_HOST;
    format!(
        "(() => {{ if (location.hostname !== '{site}') return; {MODE} {APPLY} \
         let choices = {launched}; try {{ const kept = JSON.parse(localStorage.getItem('cm-try')); \
         if (kept && kept.bar === choices.bar && kept.height === choices.height) choices = kept; }} catch {{}} \
         window.__cmTry(choices); document.documentElement.style.setProperty('--try-lights', '{room}px'); \
         document.documentElement.style.setProperty('--try-edge', '{edge}px'); \
         const style = document.createElement('style'); style.textContent = {style}; \
         document.documentElement.append(style); {DRAG} }})();"
    )
}

/// The window as the title bar choice has it: on the Mac, the head bar as
/// the title bar, with the window's buttons centered in it.
pub fn window<'a, R: Runtime>(
    app: &AppHandle<R>,
    builder: WebviewWindowBuilder<'a, R, AppHandle<R>>,
) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    let choices = load(app);
    if chosen(&choices, "bar") == "separate" {
        return builder;
    }
    #[cfg(target_os = "macos")]
    {
        let (x, y) = traffic_lights(bar_height(&choices));
        builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(x, y))
    }
    #[cfg(not(target_os = "macos"))]
    builder
}

/// The menu's items, kept to check the one chosen in each group.
struct Items(Mutex<Vec<(String, CheckMenuItem<tauri::Wry>)>>);

fn group_menu(
    app: &AppHandle<tauri::Wry>,
    group: &Group,
    choices: &Choices,
    items: &mut Vec<(String, CheckMenuItem<tauri::Wry>)>,
) -> tauri::Result<Submenu<tauri::Wry>> {
    let label = if group.relaunch {
        format!("{} (Relaunches)", group.label)
    } else {
        group.label.to_owned()
    };
    let mut menu = SubmenuBuilder::new(app, label);
    for option in group.choices {
        let id = menu_id(group.key, option.value);
        let item = CheckMenuItemBuilder::with_id(id.clone(), option.label)
            .checked(chosen(choices, group.key) == option.value)
            .build(app)?;
        menu = menu.item(&item);
        items.push((id, item));
    }
    menu.build()
}

/// The Try menu.
pub fn build(app: &AppHandle<tauri::Wry>) -> tauri::Result<Submenu<tauri::Wry>> {
    let choices = load(app);
    let mut items = Vec::new();
    let mut menu = SubmenuBuilder::new(app, "Try");
    for group in GROUPS {
        menu = menu.item(&group_menu(app, group, &choices, &mut items)?);
    }
    let mut menu = menu.separator();
    for (id, _, label) in DEMOS {
        menu = menu.item(&MenuItemBuilder::with_id(*id, *label).build(app)?);
    }
    let menu = menu
        .separator()
        .item(&MenuItemBuilder::with_id(RESET, "Back to Today's App").build(app)?)
        .build()?;
    app.manage(Items(Mutex::new(items)));
    Ok(menu)
}

fn check(app: &AppHandle<tauri::Wry>, choices: &Choices) {
    let Some(items) = app.try_state::<Items>() else {
        return;
    };
    let attributes = attributes(choices);
    for (id, item) in items
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
    {
        let on = parse_id(id).is_some_and(|(group, value)| {
            attributes
                .get(group.key)
                .is_some_and(|chosen| chosen == value)
        });
        if let Err(err) = item.set_checked(on) {
            log::debug!("could not check {id}: {err}");
        }
    }
}

/// Opens the app again once this run has quit, so the window is made with
/// the new title bar. The pause lets this run let go of being the one
/// instance first.
fn relaunch(app: &AppHandle<tauri::Wry>) {
    #[cfg(target_os = "macos")]
    {
        let bundle = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.ancestors().nth(3).map(std::path::Path::to_path_buf));
        if let Some(bundle) = bundle {
            let spawned = std::process::Command::new("/bin/sh")
                .arg("-c")
                .arg("sleep 1; /usr/bin/open \"$0\"")
                .arg(bundle)
                .spawn();
            if let Err(err) = spawned {
                log::warn!("could not open the app again: {err}");
            }
        }
        app.exit(0);
    }
    #[cfg(not(target_os = "macos"))]
    app.restart();
}

fn apply(app: &AppHandle<tauri::Wry>, choices: &Choices) {
    let Some(window) = app.get_webview_window(shell::MAIN_WINDOW) else {
        return;
    };
    let attributes = serde_json::to_string(&attributes(choices)).unwrap_or_default();
    if let Err(err) = window.eval(format!("window.__cmTry && window.__cmTry({attributes});")) {
        log::debug!("could not apply the Try choices: {err}");
    }
}

/// Takes a choice from the Try menu; other ids are not its.
pub fn on_event(app: &AppHandle<tauri::Wry>, id: &str) -> bool {
    if let Some((_, kind, _)) = DEMOS.iter().find(|(demo, _, _)| *demo == id) {
        show_demo(app, kind);
        return true;
    }
    let before = load(app);
    let (choices, relaunches) = if id == RESET {
        let relaunches = GROUPS
            .iter()
            .any(|group| group.relaunch && chosen(&before, group.key) != group.choices[0].value);
        (Choices::new(), relaunches)
    } else if let Some((group, value)) = parse_id(id) {
        let mut choices = before.clone();
        choices.insert(group.key.to_owned(), value.to_owned());
        (
            choices,
            group.relaunch && chosen(&before, group.key) != value,
        )
    } else {
        return false;
    };
    save(app, &choices);
    check(app, &choices);
    apply(app, &choices);
    if relaunches {
        relaunch(app);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{
        Choices, attributes, bar_height, chosen, demo_script, lights_room, parse_id, traffic_lights,
    };

    #[test]
    fn a_group_left_alone_is_todays() {
        let mut choices = Choices::new();
        assert_eq!(chosen(&choices, "font"), "inter");
        choices.insert("font".into(), "avenir".into());
        assert_eq!(chosen(&choices, "font"), "avenir");
        choices.insert("font".into(), "comic".into());
        assert_eq!(
            chosen(&choices, "font"),
            "inter",
            "a choice no longer offered"
        );
        assert_eq!(
            attributes(&Choices::new()).get("bar").map(String::as_str),
            Some("separate")
        );
    }

    #[test]
    fn opens_each_sample_as_the_site_draws_it() {
        assert!(demo_script("confirm").contains("tm-confirm-dialog"));
        assert!(demo_script("editor").contains("tm-edit-player"));
        let sheet = demo_script("sheet");
        assert!(sheet.contains("tm-sheet try-demo") && sheet.contains("tm-scrim try-demo"));
    }

    #[test]
    fn reads_only_its_own_ids() {
        assert!(
            parse_id("try:font:system")
                .is_some_and(|(group, value)| group.key == "font" && value == "system")
        );
        assert!(parse_id("try:font:comic").is_none());
        assert!(parse_id("try:nope:system").is_none());
        assert!(parse_id("settings").is_none());
    }

    #[test]
    fn centers_the_windows_buttons_in_the_bar() {
        // Measured: an inset of (12, 9) put the close button at (11, 3).
        assert_eq!(
            traffic_lights(32),
            (11.0, 14.0),
            "8 pt above and below in 32"
        );
        assert_eq!(traffic_lights(44), (17.0, 20.0));
        assert_eq!(
            traffic_lights(52),
            (21.0, 24.0),
            "20 pt from the left, as AppKit's toolbar"
        );
        assert_eq!(lights_room(44), 16 + 56 + 20);
        let mut choices = Choices::new();
        choices.insert("bar".into(), "none".into());
        choices.insert("height".into(), "52".into());
        assert_eq!(
            bar_height(&choices),
            32,
            "with no head bar, the strip's height"
        );
    }
}
