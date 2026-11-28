// The Mac app's side of the site's pages (mac_page.rs), called with the
// app's invoke. The window shows once the page has drawn real content, a
// right click gets the system's text menu or none, never the browser's,
// Edit > Find goes to the page's own search, and the app keeps the page's
// address as it changes, to open there again.
(invoke => {
  // Real content: a heading in the page and no skeleton, told two frames on,
  // once that has been drawn (the Android shell's "shown").
  let shown = false;
  const observer = new MutationObserver(() => queue());
  const showWhenReady = () => {
    const main = document.querySelector('main.page');
    if (shown || !main?.querySelector('h1, h2')?.textContent.trim() || main.querySelector('.skeleton')) return;
    shown = true;
    observer.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => invoke('page_shown')));
  };
  let queued = false;
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        showWhenReady();
      });
    }
  };
  const start = () => {
    queue();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };
  // The system's text menu (Look Up, Copy, Paste, spelling) where text is
  // selected or typed; elsewhere none, as in an app, rather than WebKit's
  // Reload, Download Linked File and the rest.
  document.addEventListener('contextmenu', event => {
    const typed = event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]') !== null;
    if (!typed && !window.getSelection()?.toString().trim()) event.preventDefault();
  });
  // The page's address, tab included, each time the site moves without
  // loading, so a launch opens where the last one left off.
  let address = location.href;
  const moved = () => {
    if (location.href !== address) {
      address = location.href;
      invoke('page_address', { url: address });
    }
  };
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) {
      const result = original.apply(this, args);
      moved();
      return result;
    };
  }
  addEventListener('popstate', moved);
  // Edit > Find (menu.rs): the page's own search where it shows one.
  addEventListener('cm-app-find', () => {
    const field = [...document.querySelectorAll('main input[type="search"]')].find(input => input.offsetParent);
    field?.focus();
    field?.select();
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})
