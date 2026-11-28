// The Mac app's side of the site's pages (mac_page.rs), called with the
// app's invoke. The window shows once the page has drawn real content.
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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})
