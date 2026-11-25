/**
 * Whether the site runs inside the desktop app's window. Tauri sets up its
 * bridge there before any page script runs; a normal browser has none, so
 * everything native stays out of its way.
 */
export const inNativeApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Whether the app's window can reach TOM. Only the desktop app has the TOM
 * commands; it marks its window before the page loads (TOM_FLAG_SCRIPT in
 * native/src-tauri/src/shell.rs). The Android app has Tauri's bridge but no
 * TOM, so it keeps the browser's controls, as does a desktop build older than
 * mark 3, which had the site launch TOM and send through a panel.
 */
export const hasTom = (): boolean => inNativeApp() && (window as { __CM_TOM__?: unknown }).__CM_TOM__ === 3;

/** Whether the console drives TOM for an event: only one run in TOM, never one the site runs, and only in the desktop app. */
export const drivesTom = (mode: string | undefined): boolean => mode === 'tom' && hasTom();
