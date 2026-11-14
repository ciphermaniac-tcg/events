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
        key: "sheets",
        label: "Dialogs",
        relaunch: false,
        choices: &[
            choice("site", "Centered, Side Panel (Today)"),
            choice("attached", "Attached Under the Bar"),
            choice("float", "Floating Below the Bar"),
        ],
    },
    Group {
        key: "press",
        label: "Press",
        relaunch: false,
        choices: &[
            choice("site", "The Site's (Today)"),
            choice("tint", "Ink Wash"),
            choice("dim", "Dim"),
        ],
    },
];

const RESET: &str = "try:reset";
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

/// Where the window's buttons go for a bar of `height`: centered in it,
/// with as much room at the left as above (a button is 14 px).
fn traffic_lights(height: u32) -> (f64, f64) {
    let inset = f64::from(height.saturating_sub(14)) / 2.0;
    (inset + 3.0, inset)
}

fn bar_height(choices: &Choices) -> u32 {
    chosen(choices, "height").parse().unwrap_or(44)
}

/// The room the head bar leaves at its left for the window's buttons: the
/// three buttons, 20 px apart, and a gap after them.
fn lights_room(height: u32) -> u32 {
    let (x, _) = traffic_lights(height);
    // The inset is a few points at most, so the cast keeps it whole.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let x = x.round() as u32;
    x + 54 + 16
}

/// The page's stylesheet. Every rule waits for its attribute, so with none
/// set the site is as it is today.
const STYLE: &str = r#"
:root[data-try-height="38"], :root[data-try-height="38"] body[data-mode] { --topnav-h: 38px !important; }
:root[data-try-height="40"], :root[data-try-height="40"] body[data-mode] { --topnav-h: 40px !important; }
:root[data-try-height="52"], :root[data-try-height="52"] body[data-mode] { --topnav-h: 52px !important; }
:root[data-try-height="38"] .site-head-name, :root[data-try-height="38"] .site-head-name small { font-size: 13px; }
:root[data-try-height="38"] .site-head-name img { width: 16px; height: 19px; }
:root[data-try-height="38"] .site-head .tm-acct-button { width: 24px; height: 24px; font-size: 11px; }
:root[data-try-height="38"] .site-head-signin { min-height: 24px; height: 24px; font-size: 12px; }

:root[data-try-bar="one"] .site-head-row { max-width: none; padding-left: var(--try-lights, 88px); padding-right: 16px; }
:root[data-try-bar="one"] .site-head { -webkit-user-select: none; user-select: none; }

:root[data-try-color="window"] .site-head.head-bar {
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
:root[data-try-press="dim"] :is(button, .btn, [role="tab"], [role="menuitem"], .chip):active:not(:disabled) {
  opacity: 0.55 !important; transform: none !important; transition: none !important;
}
"#;

/// Sets the root's attributes from `choices` (a JSON object) and keeps them
/// for the page's next load in this run.
const APPLY: &str = "window.__cmTry = choices => { const root = document.documentElement; \
     for (const [key, value] of Object.entries(choices)) root.setAttribute('data-try-' + key, value); \
     try { localStorage.setItem('cm-try', JSON.stringify(choices)); } catch {} };";

/// Moves the window by the head bar when it is the title bar, and zooms it
/// on a double click, as a title bar does; its links and buttons stay
/// theirs.
const DRAG: &str = "document.addEventListener('mousedown', event => { \
     if (event.button !== 0 || document.documentElement.dataset.tryBar !== 'one') return; \
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
    let room = lights_room(bar_height(&choices));
    let site = shell::SITE_HOST;
    format!(
        "(() => {{ if (location.hostname !== '{site}') return; {APPLY} \
         let choices = {launched}; try {{ const kept = JSON.parse(localStorage.getItem('cm-try')); \
         if (kept && kept.bar === choices.bar && kept.height === choices.height) choices = kept; }} catch {{}} \
         window.__cmTry(choices); document.documentElement.style.setProperty('--try-lights', '{room}px'); \
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
    if chosen(&choices, "bar") != "one" {
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
    use super::{Choices, attributes, chosen, lights_room, parse_id, traffic_lights};

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
        assert_eq!(traffic_lights(44), (18.0, 15.0));
        assert_eq!(lights_room(44), 88);
        assert_eq!(traffic_lights(38), (15.0, 12.0));
    }
}
