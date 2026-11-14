//! Whether a TOM this app did not start is already running. The helper can
//! only be added as TOM starts, so launching must not leave the operator with
//! a second TOM beside one the app cannot reach.

use std::path::Path;

/// Windows: any process running a program named like `program`.
#[cfg(windows)]
pub(crate) fn elsewhere(program: Option<&Path>) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    let Some(name) = program
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().to_lowercase())
    else {
        return false;
    };
    // SAFETY: the snapshot handle is checked and closed; the entry is sized as the API requires.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = u32::try_from(size_of::<PROCESSENTRY32W>()).unwrap_or(0);
        let mut found = false;
        let mut more = Process32FirstW(snapshot, &raw mut entry) != 0;
        while more && !found {
            found = exe_name(&entry.szExeFile) == name;
            more = Process32NextW(snapshot, &raw mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

#[cfg(windows)]
fn exe_name(wide: &[u16]) -> String {
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..len]).to_lowercase()
}

/// Elsewhere TOM is opened as a macOS app (checked when launching it) or is a
/// test stand-in, so there is nothing to look for.
#[cfg(not(windows))]
pub(crate) fn elsewhere(_program: Option<&Path>) -> bool {
    false
}
