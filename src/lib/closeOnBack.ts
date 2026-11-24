/**
 * Android's Back closes an open layer (a sheet, a menu) before it leaves the
 * page: where the browser has CloseWatcher, Back reaches `close`, latest layer
 * first. Escape stays with each layer's own keys, which know what it backs out
 * of first, so the watcher hears only Back; inside a dialog, Escape is the
 * dialog's. The Android app closes layers from its own Back (`__cmBack`), so
 * there no watcher is made. The answer lets the layer go.
 */

interface Watcher {
  onclose: (() => void) | null;
  destroy: () => void;
}

export function closeOnBack(close: () => void): () => void {
  const { CloseWatcher } = window as { CloseWatcher?: new () => Watcher };
  if (!CloseWatcher || '__cmBack' in window) {
    return () => undefined;
  }
  const watcher = new CloseWatcher();
  watcher.onclose = close;
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !(event.target as Partial<Element> | null)?.closest?.('dialog')) {
      event.preventDefault();
    }
  };
  document.addEventListener('keydown', escape, true);
  return () => {
    watcher.destroy();
    document.removeEventListener('keydown', escape, true);
  };
}
