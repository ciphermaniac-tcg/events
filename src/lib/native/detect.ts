/**
 * Whether the site runs inside the desktop app's window. Tauri sets up its
 * bridge there before any page script runs; a normal browser has none, so
 * everything native stays out of its way.
 */
export const inNativeApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
