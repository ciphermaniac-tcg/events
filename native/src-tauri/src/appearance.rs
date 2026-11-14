//! Light or dark: the system's by default. The site's footer switch is
//! hidden in the app, so on desktop View > Appearance picks System, Light or
//! Dark instead; Android always follows the system.
//!
//! The choice drives the site's own mechanism (`src/lib/theme.ts`): a mode
//! kept as `cm:mode` in the page's storage, which the site reads before it
//! draws, and `body[data-mode]`, which it paints. System clears a kept
//! mode, including one the footer switch left behind, so the site follows
//! the system again. The page's colors carry on to the window (`theme.rs`).
//!
//! The choice is kept in the app's data directory and read when the window
//! is made, which is when a page script is fixed. A change during the run
//! is also kept in the page's session storage, which outlasts reloads but
//! not the run, so pages loaded after it take it.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(
    mobile,
    expect(
        dead_code,
        reason = "a phone follows the system, with no choice to make"
    )
)]
pub enum Appearance {
    System,
    Light,
    Dark,
}

impl Appearance {
    #[cfg(desktop)]
    const ALL: [Self; 3] = [Self::System, Self::Light, Self::Dark];

    /// Its name in storage and in the page's `cm:mode`.
    const fn key(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    #[cfg(any(desktop, test))]
    fn from_key(key: &str) -> Option<Self> {
        match key.trim() {
            "system" => Some(Self::System),
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }
}

/// The script each page of the main window runs first: it puts `chosen`
/// (or the run's later choice) in the site's storage before the site reads
/// it, and leaves `__cmAppearance` for a later choice to paint the page.
pub fn script(chosen: Appearance) -> String {
    let site = crate::shell::SITE_HOST;
    let chosen = chosen.key();
    format!(
        "(() => {{ if (location.hostname !== '{site}') return; const KEY = 'cm-app:appearance'; \
         window.__cmAppearance = choice => {{ try {{ sessionStorage.setItem(KEY, choice); \
         if (choice === 'system') localStorage.removeItem('cm:mode'); \
         else localStorage.setItem('cm:mode', choice); }} catch {{}} \
         if (!document.body) return; \
         document.body.dataset.mode = choice !== 'system' ? choice \
         : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }}; \
         let choice = '{chosen}'; try {{ choice = sessionStorage.getItem(KEY) ?? choice; }} catch {{}} \
         window.__cmAppearance(choice); }})();"
    )
}

#[cfg(desktop)]
pub use desktop::{on_menu_event, page_script, setup, submenu};

#[cfg(desktop)]
mod desktop {
    use std::{fs, path::PathBuf};

    use tauri::{
        AppHandle, Manager, Runtime, Theme, WebviewWindow,
        menu::{CheckMenuItem, CheckMenuItemBuilder, Submenu, SubmenuBuilder},
    };

    use super::Appearance;
    use crate::{shell, theme};

    const FILE: &str = "appearance";
    const MENU_PREFIX: &str = "appearance:";

    impl Appearance {
        const fn label(self) -> &'static str {
            match self {
                Self::System => "System",
                Self::Light => "Light",
                Self::Dark => "Dark",
            }
        }

        fn menu_id(self) -> String {
            format!("{MENU_PREFIX}{}", self.key())
        }

        /// The window's theme: the system's, or the one chosen.
        const fn theme(self) -> Option<Theme> {
            match self {
                Self::System => None,
                Self::Light => Some(Theme::Light),
                Self::Dark => Some(Theme::Dark),
            }
        }
    }

    /// The menu's items, kept to check the one chosen.
    struct Items<R: Runtime>(Vec<(Appearance, CheckMenuItem<R>)>);

    /// The file the choice is kept in. Not `data_dir`: the menu is made
    /// before the app's setup finds that.
    fn file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
        app.path().app_data_dir().ok().map(|dir| dir.join(FILE))
    }

    fn load<R: Runtime>(app: &AppHandle<R>) -> Appearance {
        file(app)
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| Appearance::from_key(&text))
            .unwrap_or(Appearance::System)
    }

    fn save<R: Runtime>(app: &AppHandle<R>, chosen: Appearance) {
        let Some(path) = file(app) else {
            return;
        };
        let written = path
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| fs::write(&path, chosen.key()));
        if let Err(err) = written {
            log::warn!("could not keep the appearance: {err}");
        }
    }

    /// View > Appearance, with the kept choice checked.
    pub fn submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
        let chosen = load(app);
        let mut menu = SubmenuBuilder::new(app, "Appearance");
        let mut items = Vec::new();
        for appearance in Appearance::ALL {
            let item = CheckMenuItemBuilder::with_id(appearance.menu_id(), appearance.label())
                .checked(appearance == chosen)
                .build(app)?;
            menu = menu.item(&item);
            items.push((appearance, item));
        }
        app.manage(Items(items));
        menu.build()
    }

    /// Checks `chosen` alone; a click has toggled the item it was on.
    fn check<R: Runtime>(app: &AppHandle<R>, chosen: Appearance) {
        let Some(items) = app.try_state::<Items<R>>() else {
            return;
        };
        for (appearance, item) in &items.0 {
            if let Err(err) = item.set_checked(*appearance == chosen) {
                log::debug!("could not check {}: {err}", appearance.key());
            }
        }
    }

    /// Gives the window the chosen theme, for its menus, sheets and
    /// scrollbars. Not on Windows, where the title bar keeps the head bar's
    /// dark caption buttons in both modes (`title_bar.rs`).
    fn set_window_theme<R: Runtime>(window: &WebviewWindow<R>, chosen: Appearance) {
        #[cfg(not(windows))]
        if let Err(err) = window.set_theme(chosen.theme()) {
            log::debug!("could not set the window's theme: {err}");
        }
        #[cfg(windows)]
        let _ = (window, chosen);
    }

    /// Gives a new main window the kept choice: its theme, its colors
    /// before the page reports them, and the page script that applies it.
    pub fn setup<R: Runtime>(window: &WebviewWindow<R>) {
        let chosen = load(window.app_handle());
        set_window_theme(window, chosen);
        let dark = match chosen.theme() {
            Some(theme) => theme == Theme::Dark,
            None => window.theme().is_ok_and(|theme| theme == Theme::Dark),
        };
        theme::paint(window, dark);
    }

    /// The main window's page script for the kept choice.
    pub fn page_script<R: Runtime>(app: &AppHandle<R>) -> String {
        super::script(load(app))
    }

    fn apply<R: Runtime>(app: &AppHandle<R>, chosen: Appearance) {
        save(app, chosen);
        check(app, chosen);
        let Some(window) = app.get_webview_window(shell::MAIN_WINDOW) else {
            return;
        };
        set_window_theme(&window, chosen);
        let call = format!(
            "window.__cmAppearance && window.__cmAppearance('{}');",
            chosen.key()
        );
        if let Err(err) = window.eval(call) {
            log::debug!("could not apply the appearance: {err}");
        }
    }

    /// Takes a choice from View > Appearance; other ids are not its.
    pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) -> bool {
        let Some(chosen) = id.strip_prefix(MENU_PREFIX).and_then(Appearance::from_key) else {
            return false;
        };
        apply(app, chosen);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{Appearance, script};

    #[test]
    fn reads_only_the_three_choices() {
        assert_eq!(Appearance::from_key("dark\n"), Some(Appearance::Dark));
        assert_eq!(Appearance::from_key("system"), Some(Appearance::System));
        assert_eq!(Appearance::from_key("sepia"), None);
    }

    #[test]
    fn keeps_the_sites_mode_for_a_choice_and_clears_it_for_the_system() {
        let script = script(Appearance::Light);
        assert!(script.contains("location.hostname !== 'events.ciphermaniac.com'"));
        assert!(script.contains("let choice = 'light'"));
        assert!(script.contains("localStorage.removeItem('cm:mode')"));
        assert!(script.contains("localStorage.setItem('cm:mode', choice)"));
        assert!(script.contains("document.body.dataset.mode"));
    }
}
