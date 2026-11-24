import { createSignal, onCleanup } from 'solid-js';
import { t } from '../../lib/i18n';

/**
 * Where every copy is said aloud: one polite live region, in the page before
 * the first copy so a screen reader hears that one too. Not a status, which
 * would stand beside a page's own.
 */
let spoken: HTMLElement | undefined;
function liveRegion(): HTMLElement {
  if (!spoken) {
    spoken = document.createElement('span');
    spoken.className = 'sr-only';
    spoken.setAttribute('aria-live', 'polite');
    document.body.append(spoken);
  }
  return spoken;
}

/**
 * A copy button's state: `copy(text)` writes to the clipboard and reads as
 * copied for a moment; `flash()` reads as copied after a copy made some other
 * way, and says so to a screen reader. A browser that refuses the clipboard
 * leaves it as it was.
 */
export function createCopied() {
  const [copied, setCopied] = createSignal(false);
  const region = liveRegion();
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  function flash() {
    setCopied(true);
    region.textContent = t('Copied');
    clearTimeout(timer);
    timer = setTimeout(() => {
      setCopied(false);
      region.textContent = '';
    }, 1500);
  }
  async function copy(text: string) {
    const done = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false
    );
    if (done) {
      flash();
    }
  }
  return { copied, copy, flash };
}
