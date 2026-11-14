//! The browser's own shortcuts on Windows, cut to those a Windows app keeps:
//! Ctrl+F to find on the page, F5 to reload, and Alt+Left and Alt+Right (and
//! a keyboard's Back and Forward keys) to go back and forward. Print, save
//! page, view source, the developer tools outside debug builds and the rest
//! do nothing; the page still gets every key, and the menu bar's shortcuts
//! still run.

/// A key press, by Windows virtual-key code, with the modifiers held.
#[derive(Clone, Copy, Debug, Default)]
struct Press {
    key: u32,
    ctrl: bool,
    shift: bool,
    alt: bool,
}

const KEY_F: u32 = 0x46;
const KEY_I: u32 = 0x49;
const LEFT: u32 = 0x25;
const RIGHT: u32 = 0x27;
const F5: u32 = 0x74;
const F12: u32 = 0x7b;
const BROWSER_BACK: u32 = 0xa6;
const BROWSER_FORWARD: u32 = 0xa7;

/// Whether the browser may act on a press.
fn browser_keeps(press: Press) -> bool {
    let Press {
        key,
        ctrl,
        shift,
        alt,
    } = press;
    let plain = !ctrl && !shift && !alt;
    let kept = match key {
        KEY_F => ctrl && !shift && !alt,
        F5 | BROWSER_BACK | BROWSER_FORWARD => plain,
        LEFT | RIGHT => alt && !ctrl && !shift,
        _ => false,
    };
    kept || (cfg!(debug_assertions) && opens_devtools(press))
}

fn opens_devtools(press: Press) -> bool {
    (press.key == F12 && !press.ctrl && !press.alt)
        || (press.key == KEY_I && press.ctrl && press.shift && !press.alt)
}

#[cfg(windows)]
pub use hook::install;

#[cfg(windows)]
mod hook {
    use webview2_com::{
        AcceleratorKeyPressedEventHandler,
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
            COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
            ICoreWebView2AcceleratorKeyPressedEventArgs,
            ICoreWebView2AcceleratorKeyPressedEventArgs2, ICoreWebView2Controller,
        },
    };
    use windows::{
        Win32::UI::Input::KeyboardAndMouse::{
            GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT,
        },
        core::{Interface, Result},
    };

    use super::{Press, browser_keeps};

    /// Decides, key by key, which browser shortcuts still run.
    pub fn install(controller: &ICoreWebView2Controller) -> Result<()> {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(|_, args| {
            args.map_or(Ok(()), |args| decide(&args))
        }));
        let mut token = 0;
        // SAFETY: a WebView2 call on the UI thread, which `with_webview` runs on.
        unsafe { controller.add_AcceleratorKeyPressed(&handler, &raw mut token) }
    }

    fn held(key: VIRTUAL_KEY) -> bool {
        // SAFETY: reads the calling thread's keyboard state.
        unsafe { GetKeyState(i32::from(key.0)) < 0 }
    }

    fn decide(args: &ICoreWebView2AcceleratorKeyPressedEventArgs) -> Result<()> {
        let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
        let mut key = 0;
        // SAFETY: WebView2 calls on the UI thread, inside the event.
        unsafe {
            args.KeyEventKind(&raw mut kind)?;
            args.VirtualKey(&raw mut key)?;
        }
        if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
            && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
        {
            return Ok(());
        }
        let press = Press {
            key,
            ctrl: held(VK_CONTROL),
            shift: held(VK_SHIFT),
            alt: held(VK_MENU),
        };
        let args: ICoreWebView2AcceleratorKeyPressedEventArgs2 = args.cast()?;
        // SAFETY: as above.
        unsafe { args.SetIsBrowserAcceleratorKeyEnabled(browser_keeps(press)) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctrl(key: u32) -> Press {
        Press {
            key,
            ctrl: true,
            ..Press::default()
        }
    }

    fn plain(key: u32) -> Press {
        Press {
            key,
            ..Press::default()
        }
    }

    fn alt(key: u32) -> Press {
        Press {
            key,
            alt: true,
            ..Press::default()
        }
    }

    #[test]
    fn keeps_find_reload_and_back_and_forward() {
        assert!(browser_keeps(ctrl(KEY_F)));
        assert!(browser_keeps(plain(F5)));
        assert!(browser_keeps(alt(LEFT)));
        assert!(browser_keeps(alt(RIGHT)));
        assert!(browser_keeps(plain(BROWSER_BACK)));
        assert!(browser_keeps(plain(BROWSER_FORWARD)));
    }

    #[test]
    fn drops_the_browsers_other_shortcuts() {
        let print = 0x50;
        let save = 0x53;
        let source = 0x55;
        let find_next = 0x72;
        let escape = 0x1b;
        assert!(!browser_keeps(ctrl(print)));
        assert!(!browser_keeps(ctrl(save)));
        assert!(!browser_keeps(ctrl(source)));
        assert!(!browser_keeps(ctrl(F5)), "hard reload");
        assert!(!browser_keeps(plain(find_next)));
        assert!(!browser_keeps(plain(escape)));
        assert!(!browser_keeps(plain(LEFT)), "plain arrows are the page's");
    }

    #[test]
    fn keeps_the_developer_tools_in_debug_builds_only() {
        let inspect = Press {
            key: KEY_I,
            ctrl: true,
            shift: true,
            alt: false,
        };
        assert_eq!(browser_keeps(inspect), cfg!(debug_assertions));
        assert_eq!(browser_keeps(plain(F12)), cfg!(debug_assertions));
    }
}
