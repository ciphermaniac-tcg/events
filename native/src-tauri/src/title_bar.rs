//! Windows 11's title bar in the head bar's color, so the two read as one
//! dark band in either mode. The head bar is dark in both modes, so the
//! title bar keeps Windows' dark caption buttons in both; only its color
//! steps with the site's mode, as the head bar's does. Windows 10 has no
//! caption color, so its title bar is left as the system draws it.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Runtime, WebviewWindow, WindowEvent};
use windows::{
    Win32::{
        Foundation::{COLORREF, HWND},
        Graphics::Dwm::{
            DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
            DWMWINDOWATTRIBUTE, DwmSetWindowAttribute,
        },
    },
    core::BOOL,
};

/// A color as Windows takes it, 0x00BBGGRR.
const fn rgb(red: u8, green: u8, blue: u8) -> COLORREF {
    COLORREF(red as u32 | (green as u32) << 8 | (blue as u32) << 16)
}

/// The head bar's color in each mode, and its text (`.head-bar` in the
/// design package's tokens.css).
const LIGHT_BAR: COLORREF = rgb(0x1c, 0x1d, 0x1b);
const DARK_BAR: COLORREF = rgb(0x23, 0x24, 0x22);
const BAR_TEXT: COLORREF = rgb(0xf1, 0xf1, 0xee);

/// The mode last painted, for repainting after Windows' own theme change.
static DARK: AtomicBool = AtomicBool::new(false);

fn set<T>(hwnd: HWND, attribute: DWMWINDOWATTRIBUTE, value: &T) -> windows::core::Result<()> {
    let size = u32::try_from(size_of::<T>()).unwrap_or(u32::MAX);
    // SAFETY: `value` is a live value of the size passed with it.
    unsafe { DwmSetWindowAttribute(hwnd, attribute, std::ptr::from_ref(value).cast(), size) }
}

/// Paints the title bar for the site's mode.
pub fn paint<R: Runtime>(window: &WebviewWindow<R>, dark: bool) {
    DARK.store(dark, Ordering::Relaxed);
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let caption = if dark { DARK_BAR } else { LIGHT_BAR };
    // Windows 10 refuses a caption color; its title bar stays the system's.
    if set(hwnd, DWMWA_CAPTION_COLOR, &caption).is_err() {
        return;
    }
    let painted = set(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &BOOL::from(true))
        .and_then(|()| set(hwnd, DWMWA_TEXT_COLOR, &BAR_TEXT));
    if let Err(err) = painted {
        log::debug!("could not paint the title bar: {err}");
    }
}

/// Repaints the title bar whenever Windows changes its theme, which resets
/// the window's dark caption buttons to the system's.
pub fn keep_through_theme_changes<R: Runtime>(window: &WebviewWindow<R>) {
    let painted = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(_) = event {
            paint(&painted, DARK.load(Ordering::Relaxed));
        }
    });
}
