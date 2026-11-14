//! Keys mode on macOS: TOM's process from libproc, its windows and focus
//! through the Accessibility API, keystrokes as Quartz events.
//!
//! Both reading other apps' window titles and posting keystrokes need the
//! Accessibility permission. Digits go as keypad keys, which type digits on
//! every layout.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use libc::pid_t;

use super::{Desktop, OsWindow};

const FULL_NAME: &str = "Tournament Operations Manager";
const KEYPAD_DIGITS: [CGKeyCode; 10] = [82, 83, 84, 85, 86, 87, 88, 89, 91, 92];
const RETURN: CGKeyCode = 36;
const S: CGKeyCode = 1;
const KEY_GAP: Duration = Duration::from_millis(5);
const NO_ACCESS: &str = "Keys mode needs permission to control this computer. Allow Ciphermaniac Events in \
                         System Settings > Privacy & Security > Accessibility, then try again.";

static PROMPTED: AtomicBool = AtomicBool::new(false);

type AXError = i32;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    static kAXTrustedCheckOptionPrompt: CFStringRef;
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    fn AXUIElementCreateApplication(pid: pid_t) -> CFTypeRef;
    fn AXUIElementCreateSystemWide() -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(
        element: CFTypeRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: CFTypeRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    fn AXUIElementPerformAction(element: CFTypeRef, action: CFStringRef) -> AXError;
    fn AXUIElementGetPid(element: CFTypeRef, pid: *mut pid_t) -> AXError;
}

/// An accessibility element, retained for as long as this value lives.
#[derive(Clone)]
pub(crate) struct Element(CFType);

impl Element {
    fn created(raw: CFTypeRef) -> Option<Self> {
        // SAFETY: AX "Create" functions return +1 references, or null.
        (!raw.is_null()).then(|| Self(unsafe { CFType::wrap_under_create_rule(raw) }))
    }

    fn application(pid: pid_t) -> Option<Self> {
        // SAFETY: plain constructor.
        Self::created(unsafe { AXUIElementCreateApplication(pid) })
    }

    fn system_wide() -> Option<Self> {
        // SAFETY: plain constructor.
        Self::created(unsafe { AXUIElementCreateSystemWide() })
    }

    fn attribute(&self, name: &'static str) -> Option<CFType> {
        let mut value: CFTypeRef = std::ptr::null();
        let name = CFString::from_static_string(name);
        // SAFETY: `value` receives a +1 reference on success.
        let error = unsafe {
            AXUIElementCopyAttributeValue(
                self.0.as_CFTypeRef(),
                name.as_concrete_TypeRef(),
                &raw mut value,
            )
        };
        // SAFETY: on success `value` is an owned reference.
        (error == 0 && !value.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(value) })
    }

    fn element(&self, name: &'static str) -> Option<Self> {
        self.attribute(name).map(Self)
    }

    fn title(&self) -> Option<String> {
        self.attribute("AXTitle")?
            .downcast_into::<CFString>()
            .map(|s| s.to_string())
    }

    fn set_true(&self, name: &'static str) -> bool {
        let name = CFString::from_static_string(name);
        let value = CFBoolean::true_value();
        // SAFETY: both references are valid for the call.
        unsafe {
            AXUIElementSetAttributeValue(
                self.0.as_CFTypeRef(),
                name.as_concrete_TypeRef(),
                value.as_CFTypeRef(),
            ) == 0
        }
    }

    fn perform(&self, action: &'static str) -> bool {
        let action = CFString::from_static_string(action);
        // SAFETY: both references are valid for the call.
        unsafe {
            AXUIElementPerformAction(self.0.as_CFTypeRef(), action.as_concrete_TypeRef()) == 0
        }
    }

    fn pid(&self) -> Option<pid_t> {
        let mut pid: pid_t = 0;
        // SAFETY: `pid` outlives the call.
        let error = unsafe { AXUIElementGetPid(self.0.as_CFTypeRef(), &raw mut pid) };
        (error == 0).then_some(pid)
    }
}

fn trusted(prompt: bool) -> bool {
    if prompt && !PROMPTED.swap(true, Ordering::Relaxed) {
        // SAFETY: the key is a framework constant; the dictionary lives through the call.
        let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
        let options = CFDictionary::from_CFType_pairs(&[(
            key.as_CFType(),
            CFBoolean::true_value().as_CFType(),
        )]);
        // SAFETY: valid dictionary reference.
        return unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) };
    }
    // SAFETY: no arguments.
    unsafe { AXIsProcessTrusted() }
}

fn process_path(pid: pid_t) -> Option<PathBuf> {
    let mut buffer = vec![0u8; usize::try_from(libc::PROC_PIDPATHINFO_MAXSIZE).ok()?];
    let size = u32::try_from(buffer.len()).ok()?;
    // SAFETY: the buffer is as large as we say.
    let len = unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast::<c_void>(), size) };
    buffer.truncate(usize::try_from(len).ok().filter(|&len| len > 0)?);
    Some(PathBuf::from(String::from_utf8_lossy(&buffer).into_owned()))
}

fn all_pids() -> Vec<pid_t> {
    // SAFETY: a null buffer asks for the count.
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    let mut pids: Vec<pid_t> = vec![0; usize::try_from(count).unwrap_or(0) + 64];
    let bytes = i32::try_from(pids.len() * size_of::<pid_t>()).unwrap_or(i32::MAX);
    // SAFETY: the buffer is as large as we say.
    let found = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast::<c_void>(), bytes) };
    pids.truncate(usize::try_from(found).unwrap_or(0));
    pids
}

fn key(
    source: &CGEventSource,
    code: CGKeyCode,
    down: bool,
    flags: CGEventFlags,
) -> Result<(), String> {
    let event = CGEvent::new_keyboard_event(source.clone(), code, down)
        .map_err(|()| "macOS refused to create a keystroke.".to_owned())?;
    event.set_flags(flags);
    event.post(CGEventTapLocation::HID);
    thread::sleep(KEY_GAP);
    Ok(())
}

fn tap(code: CGKeyCode, flags: CGEventFlags) -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|()| "macOS refused to create a keystroke source.".to_owned())?;
    key(&source, code, true, flags)?;
    key(&source, code, false, flags)
}

pub(crate) struct Platform {
    tom_path: Option<PathBuf>,
}

impl Platform {
    /// `tom_path`, when set, also identifies TOM's process by its program.
    #[expect(clippy::unnecessary_wraps, reason = "same signature on every platform")]
    pub(crate) fn open(tom_path: Option<&Path>) -> Result<Self, String> {
        Ok(Self {
            tom_path: tom_path.map(Path::to_path_buf),
        })
    }

    fn is_tom(&self, path: &Path) -> bool {
        self.tom_path.as_deref() == Some(path) || path.to_string_lossy().contains(FULL_NAME)
    }

    fn focused_app() -> Option<Element> {
        Element::system_wide()?.element("AXFocusedApplication")
    }
}

impl Desktop for Platform {
    type Handle = Element;
    type Focus = pid_t;

    fn check_access(&mut self, prompt: bool) -> Result<(), String> {
        if trusted(prompt) {
            Ok(())
        } else {
            Err(NO_ACCESS.into())
        }
    }

    fn windows(&mut self) -> Result<Vec<OsWindow<Element>>, String> {
        let mut out = Vec::new();
        for pid in all_pids() {
            if !process_path(pid).is_some_and(|path| self.is_tom(&path)) {
                continue;
            }
            let windows = Element::application(pid)
                .and_then(|app| app.attribute("AXWindows"))
                .and_then(CFType::downcast_into::<CFArray>);
            for window in windows.iter().flat_map(|list| list.iter()) {
                // SAFETY: the array holds AX elements and is alive; this takes our own reference.
                let element = Element(unsafe { CFType::wrap_under_get_rule(*window) });
                if let Some(title) = element.title().filter(|title| !title.is_empty()) {
                    out.push(OsWindow {
                        handle: element,
                        title,
                        pid: u32::try_from(pid).ok(),
                    });
                }
            }
        }
        Ok(out)
    }

    fn focus(&mut self) -> Result<pid_t, String> {
        Self::focused_app()
            .and_then(|app| app.pid())
            .ok_or_else(|| NO_ACCESS.into())
    }

    fn foreground_title(&mut self) -> Result<Option<String>, String> {
        Ok(Self::focused_app()
            .and_then(|app| app.element("AXFocusedWindow"))
            .and_then(|w| w.title()))
    }

    fn activate(&mut self, window: &Element) -> Result<(), String> {
        let app = window
            .pid()
            .and_then(Element::application)
            .ok_or("TOM's window has gone.")?;
        app.set_true("AXFrontmost");
        window.set_true("AXMain");
        window.perform("AXRaise");
        Ok(())
    }

    fn type_digits(&mut self, digits: &str) -> Result<(), String> {
        for digit in digits.bytes().filter(u8::is_ascii_digit) {
            tap(
                KEYPAD_DIGITS[usize::from(digit - b'0')],
                CGEventFlags::CGEventFlagNull,
            )?;
        }
        Ok(())
    }

    fn press_enter(&mut self) -> Result<(), String> {
        tap(RETURN, CGEventFlags::CGEventFlagNull)
    }

    fn press_save(&mut self) -> Result<(), String> {
        tap(S, CGEventFlags::CGEventFlagCommand)
    }

    fn restore(&mut self, focus: pid_t) -> Result<(), String> {
        if let Some(app) = Element::application(focus) {
            app.set_true("AXFrontmost");
        }
        Ok(())
    }
}
