import { createSignal, onCleanup } from 'solid-js';

/**
 * A copy button's state: `copy(text)` writes to the clipboard and reads as
 * copied for a moment. A browser that refuses the clipboard leaves it as it was.
 */
export function createCopied() {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  async function copy(text: string) {
    const done = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false
    );
    if (done) {
      setCopied(true);
      clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 1500);
    }
  }
  return { copied, copy };
}
