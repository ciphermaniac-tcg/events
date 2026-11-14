//! Keys mode on Windows: window titles from `EnumWindows`, keystrokes from `SendInput`.
//!
//! Digits go as numeric keypad keys, which type digits on every layout.

use std::path::Path;

use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, MapVirtualKeyW,
    SendInput, VIRTUAL_KEY, VK_CONTROL, VK_NUMPAD0, VK_RETURN, VK_S,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SW_RESTORE, SetForegroundWindow,
    ShowWindow,
};
use windows_sys::core::BOOL;

use super::{Desktop, Foreground, OsWindow};

pub(crate) struct Platform;

impl Platform {
    /// Windows finds TOM by its window titles alone.
    #[expect(clippy::unnecessary_wraps, reason = "same signature on every platform")]
    pub(crate) fn open(_tom_path: Option<&Path>) -> Result<Self, String> {
        Ok(Self)
    }
}

fn title(window: HWND) -> String {
    // SAFETY: `window` came from the OS; the buffer is sized from its reported length.
    unsafe {
        let len = GetWindowTextLengthW(window);
        let mut buffer = vec![0u16; usize::try_from(len).unwrap_or(0) + 1];
        let copied = GetWindowTextW(window, buffer.as_mut_ptr(), len + 1);
        String::from_utf16_lossy(&buffer[..usize::try_from(copied).unwrap_or(0)])
    }
}

fn pid_and_thread(window: HWND) -> (u32, u32) {
    let mut pid = 0;
    // SAFETY: `pid` outlives the call.
    let thread = unsafe { GetWindowThreadProcessId(window, &raw mut pid) };
    (pid, thread)
}

unsafe extern "system" fn collect(window: HWND, list: LPARAM) -> BOOL {
    // SAFETY: `list` is the `Vec` passed to `EnumWindows` below, alive for the whole enumeration.
    let list = unsafe { &mut *(list as *mut Vec<HWND>) };
    list.push(window);
    1
}

/// `SetForegroundWindow` only works for the foreground thread's input queue,
/// so join that queue for the duration of the call.
fn force_foreground(window: HWND) -> bool {
    // SAFETY: plain Win32 calls on window handles from the OS; the queue is detached again.
    unsafe {
        if IsIconic(window) != 0 {
            ShowWindow(window, SW_RESTORE);
        }
        if SetForegroundWindow(window) != 0 {
            return true;
        }
        let (_, foreground_thread) = pid_and_thread(GetForegroundWindow());
        let ours = GetCurrentThreadId();
        let attached = foreground_thread != 0 && AttachThreadInput(ours, foreground_thread, 1) != 0;
        BringWindowToTop(window);
        let moved = SetForegroundWindow(window) != 0;
        if attached {
            AttachThreadInput(ours, foreground_thread, 0);
        }
        moved
    }
}

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    // SAFETY: MapVirtualKeyW only reads the current layout.
    let scan = unsafe { MapVirtualKeyW(u32::from(vk), MAPVK_VK_TO_VSC) };
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: u16::try_from(scan).unwrap_or(0),
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn send(inputs: &[INPUT]) -> Result<(), String> {
    let count = u32::try_from(inputs.len()).map_err(|_| "Too many keystrokes at once.")?;
    let size = i32::try_from(size_of::<INPUT>()).map_err(|_| "Keystroke size overflow.")?;
    // SAFETY: `inputs` is a valid slice of initialized INPUT structs.
    let sent = unsafe { SendInput(count, inputs.as_ptr(), size) };
    if sent == count {
        Ok(())
    } else {
        Err("Windows blocked the keystrokes. TOM may be running as administrator.".into())
    }
}

fn tap(vk: VIRTUAL_KEY) -> [INPUT; 2] {
    [key(vk, false), key(vk, true)]
}

impl Desktop for Platform {
    type Handle = HWND;
    type Focus = HWND;

    fn windows(&mut self) -> Result<Vec<OsWindow<HWND>>, String> {
        let mut handles: Vec<HWND> = Vec::new();
        // SAFETY: `collect` only pushes into `handles`, which outlives the call.
        unsafe { EnumWindows(Some(collect), &raw mut handles as LPARAM) };
        Ok(handles
            .into_iter()
            // SAFETY: handles came from EnumWindows.
            .filter(|&window| unsafe { IsWindowVisible(window) } != 0)
            .map(|window| OsWindow {
                handle: window,
                title: title(window),
                pid: Some(pid_and_thread(window).0),
            })
            .filter(|window| !window.title.is_empty())
            .collect())
    }

    fn focus(&mut self) -> Result<HWND, String> {
        // SAFETY: no arguments.
        Ok(unsafe { GetForegroundWindow() })
    }

    fn foreground(&mut self) -> Result<Option<Foreground>, String> {
        // SAFETY: no arguments.
        let window = unsafe { GetForegroundWindow() };
        Ok((!window.is_null()).then(|| Foreground {
            title: title(window),
            pid: Some(pid_and_thread(window).0),
        }))
    }

    fn activate(&mut self, window: &HWND) -> Result<(), String> {
        if force_foreground(*window) {
            Ok(())
        } else {
            Err("Windows would not bring TOM to the front.".into())
        }
    }

    fn type_digits(&mut self, digits: &str) -> Result<(), String> {
        let inputs: Vec<INPUT> = digits
            .bytes()
            .filter(u8::is_ascii_digit)
            .flat_map(|digit| tap(VK_NUMPAD0 + u16::from(digit - b'0')))
            .collect();
        send(&inputs)
    }

    fn press_enter(&mut self) -> Result<(), String> {
        send(&tap(VK_RETURN))
    }

    fn press_save(&mut self) -> Result<(), String> {
        send(&[
            key(VK_CONTROL, false),
            key(VK_S, false),
            key(VK_S, true),
            key(VK_CONTROL, true),
        ])
    }

    fn restore(&mut self, focus: HWND) -> Result<(), String> {
        if !focus.is_null() {
            force_foreground(focus);
        }
        Ok(())
    }
}
