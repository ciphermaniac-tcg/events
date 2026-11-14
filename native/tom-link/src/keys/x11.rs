//! Keys mode on X11: window titles from the X server, keystrokes through XTEST.

use std::collections::HashMap;
use std::path::Path;

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ClientMessageEvent, ConfigureWindowAux, ConnectionExt as _, EventMask,
    InputFocus, MapState, StackMode, Window,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;
use x11rb::{CURRENT_TIME, NONE};

use super::{Desktop, OsWindow};

const POINTER_ROOT: Window = 1;
const KEY_PRESS: u8 = 2;
const KEY_RELEASE: u8 = 3;
const XK_RETURN: u32 = 0xff0d;
const XK_SHIFT_L: u32 = 0xffe1;
const XK_CONTROL_L: u32 = 0xffe3;
const XK_S: u32 = 0x73;

struct Atoms {
    client_list: Atom,
    active_window: Atom,
    wm_name: Atom,
    wm_pid: Atom,
    utf8: Atom,
    wm_check: Atom,
}

pub(crate) struct Platform {
    conn: RustConnection,
    root: Window,
    atoms: Atoms,
    /// Keysym to (keycode, needs Shift).
    keys: HashMap<u32, (u8, bool)>,
}

fn x_error(error: impl std::fmt::Display) -> String {
    format!("The X display could not be used: {error}")
}

impl Platform {
    /// Connects to the display named by `DISPLAY`. X11 finds TOM by its window titles alone.
    pub(crate) fn open(_tom_path: Option<&Path>) -> Result<Self, String> {
        let (conn, screen) = RustConnection::connect(None).map_err(x_error)?;
        let root = conn.setup().roots[screen].root;
        let atoms = Atoms {
            client_list: intern(&conn, "_NET_CLIENT_LIST")?,
            active_window: intern(&conn, "_NET_ACTIVE_WINDOW")?,
            wm_name: intern(&conn, "_NET_WM_NAME")?,
            wm_pid: intern(&conn, "_NET_WM_PID")?,
            utf8: intern(&conn, "UTF8_STRING")?,
            wm_check: intern(&conn, "_NET_SUPPORTING_WM_CHECK")?,
        };
        let keys = keymap(&conn)?;
        Ok(Self {
            conn,
            root,
            atoms,
            keys,
        })
    }

    fn property(&self, window: Window, property: Atom, kind: impl Into<Atom>) -> Option<Vec<u8>> {
        let reply = self
            .conn
            .get_property(false, window, property, kind, 0, 4096)
            .ok()?
            .reply()
            .ok()?;
        (reply.format != 0).then_some(reply.value)
    }

    fn cardinals(&self, window: Window, property: Atom, kind: impl Into<Atom>) -> Option<Vec<u32>> {
        let bytes = self.property(window, property, kind)?;
        Some(
            bytes
                .as_chunks::<4>()
                .0
                .iter()
                .map(|chunk| u32::from_ne_bytes(*chunk))
                .collect(),
        )
    }

    fn title(&self, window: Window) -> Option<String> {
        self.property(window, self.atoms.wm_name, self.atoms.utf8)
            .or_else(|| self.property(window, AtomEnum::WM_NAME.into(), AtomEnum::STRING))
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .filter(|title| !title.is_empty())
    }

    fn viewable(&self, window: Window) -> bool {
        let attributes = self
            .conn
            .get_window_attributes(window)
            .ok()
            .and_then(|c| c.reply().ok());
        attributes.is_some_and(|a| a.map_state == MapState::VIEWABLE)
    }

    /// Managed windows when a window manager lists them, otherwise the root's children.
    fn top_levels(&self) -> Result<Vec<Window>, String> {
        if let Some(list) = self.cardinals(self.root, self.atoms.client_list, AtomEnum::WINDOW) {
            return Ok(list);
        }
        let tree = self
            .conn
            .query_tree(self.root)
            .map_err(x_error)?
            .reply()
            .map_err(x_error)?;
        Ok(tree.children)
    }

    fn has_window_manager(&self) -> bool {
        self.property(self.root, self.atoms.wm_check, AtomEnum::WINDOW)
            .is_some()
    }

    /// Java takes keys only through the hidden `FocusProxy` child of each of
    /// its windows; focus on the window itself is ignored.
    fn focus_target(&self, window: Window) -> Window {
        let is_proxy = |w: Window| {
            self.property(w, AtomEnum::WM_CLASS.into(), AtomEnum::STRING)
                .is_some_and(|class| class.split(|&b| b == 0).any(|part| part == b"FocusProxy"))
        };
        let mut pending = vec![window];
        while let Some(current) = pending.pop() {
            if is_proxy(current) {
                return current;
            }
            if let Some(tree) = self
                .conn
                .query_tree(current)
                .ok()
                .and_then(|c| c.reply().ok())
            {
                pending.extend(tree.children);
            }
        }
        window
    }

    /// Walks up from a focused child to the window that is a child of the root.
    fn top_level_of(&self, mut window: Window) -> Option<Window> {
        loop {
            let tree = self.conn.query_tree(window).ok()?.reply().ok()?;
            if tree.parent == self.root || tree.parent == NONE {
                return Some(window);
            }
            window = tree.parent;
        }
    }

    /// The window manager's active window, or else the raw X input focus.
    fn raw_focus(&self) -> Option<Window> {
        let active = self.cardinals(self.root, self.atoms.active_window, AtomEnum::WINDOW);
        if let Some(window) = active
            .and_then(|list| list.first().copied())
            .filter(|&w| w != NONE)
        {
            return Some(window);
        }
        Some(self.conn.get_input_focus().ok()?.reply().ok()?.focus)
    }

    fn focused(&self) -> Option<Window> {
        let focus = self
            .raw_focus()
            .filter(|&w| w != NONE && w != POINTER_ROOT)?;
        self.top_level_of(focus)
    }

    fn key(&self, keysym: u32, press: bool) -> Result<(), String> {
        let &(code, shift) = self
            .keys
            .get(&keysym)
            .ok_or_else(|| format!("The keyboard layout has no key for {keysym:#x}."))?;
        let kind = if press { KEY_PRESS } else { KEY_RELEASE };
        if shift && press {
            self.raw(KEY_PRESS, XK_SHIFT_L)?;
        }
        self.conn
            .xtest_fake_input(kind, code, CURRENT_TIME, self.root, 0, 0, 0)
            .map_err(x_error)?;
        if shift && !press {
            self.raw(KEY_RELEASE, XK_SHIFT_L)?;
        }
        Ok(())
    }

    fn raw(&self, kind: u8, keysym: u32) -> Result<(), String> {
        let (code, _) = self
            .keys
            .get(&keysym)
            .copied()
            .ok_or("The keyboard layout has no Shift key.")?;
        self.conn
            .xtest_fake_input(kind, code, CURRENT_TIME, self.root, 0, 0, 0)
            .map_err(x_error)?;
        Ok(())
    }

    fn tap(&self, keysym: u32) -> Result<(), String> {
        self.key(keysym, true)?;
        self.key(keysym, false)
    }

    fn sync(&self) -> Result<(), String> {
        self.conn.sync().map_err(x_error)
    }
}

fn intern(conn: &RustConnection, name: &str) -> Result<Atom, String> {
    Ok(conn
        .intern_atom(false, name.as_bytes())
        .map_err(x_error)?
        .reply()
        .map_err(x_error)?
        .atom)
}

/// Where each keysym sits: unshifted first, else on the Shift level.
fn keymap(conn: &RustConnection) -> Result<HashMap<u32, (u8, bool)>, String> {
    let setup = conn.setup();
    let (min, max) = (setup.min_keycode, setup.max_keycode);
    let mapping = conn
        .get_keyboard_mapping(min, max - min + 1)
        .map_err(x_error)?
        .reply()
        .map_err(x_error)?;
    let per = usize::from(mapping.keysyms_per_keycode).max(1);
    let mut keys = HashMap::new();
    for level in [0, 1] {
        for (code, syms) in (min..=max).zip(mapping.keysyms.chunks(per)) {
            if let Some(&sym) = syms.get(level).filter(|&&sym| sym != 0) {
                keys.entry(sym).or_insert((code, level == 1));
            }
        }
    }
    Ok(keys)
}

impl Desktop for Platform {
    type Handle = Window;
    type Focus = Window;

    fn windows(&mut self) -> Result<Vec<OsWindow<Window>>, String> {
        Ok(self
            .top_levels()?
            .into_iter()
            .filter(|&window| self.viewable(window))
            .filter_map(|window| {
                let title = self.title(window)?;
                let pid = self
                    .cardinals(window, self.atoms.wm_pid, AtomEnum::CARDINAL)
                    .and_then(|list| list.first().copied());
                Some(OsWindow {
                    handle: window,
                    title,
                    pid,
                })
            })
            .collect())
    }

    fn focus(&mut self) -> Result<Window, String> {
        self.raw_focus()
            .ok_or_else(|| x_error("the input focus is unknown"))
    }

    fn foreground_title(&mut self) -> Result<Option<String>, String> {
        Ok(self.focused().and_then(|window| self.title(window)))
    }

    fn activate(&mut self, window: &Window) -> Result<(), String> {
        let above = ConfigureWindowAux::new().stack_mode(StackMode::ABOVE);
        self.conn
            .configure_window(*window, &above)
            .map_err(x_error)?;
        if self.has_window_manager() {
            let request = ClientMessageEvent::new(
                32,
                *window,
                self.atoms.active_window,
                [2, CURRENT_TIME, 0, 0, 0],
            );
            let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
            self.conn
                .send_event(false, self.root, mask, request)
                .map_err(x_error)?;
        } else {
            self.conn
                .set_input_focus(InputFocus::PARENT, self.focus_target(*window), CURRENT_TIME)
                .map_err(x_error)?;
        }
        self.sync()
    }

    fn type_digits(&mut self, digits: &str) -> Result<(), String> {
        for digit in digits.chars() {
            self.tap(u32::from(digit))?;
        }
        self.sync()
    }

    fn press_enter(&mut self) -> Result<(), String> {
        self.tap(XK_RETURN)?;
        self.sync()
    }

    fn press_save(&mut self) -> Result<(), String> {
        self.raw(KEY_PRESS, XK_CONTROL_L)?;
        self.tap(XK_S)?;
        self.raw(KEY_RELEASE, XK_CONTROL_L)?;
        self.sync()
    }

    fn restore(&mut self, focus: Window) -> Result<(), String> {
        if focus != NONE && focus != POINTER_ROOT {
            return self.activate(&focus);
        }
        self.conn
            .set_input_focus(InputFocus::POINTER_ROOT, focus, CURRENT_TIME)
            .map_err(x_error)?;
        self.sync()
    }
}
