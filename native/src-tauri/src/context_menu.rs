//! The right-click menu a Windows app shows: undo, cut, copy, paste and
//! select all, plus spelling suggestions in a field. `WebView2`'s own items
//! (Back, Refresh, Save as, Print, Share, the link and image items, and
//! Inspect outside debug builds) are dropped, and where nothing is left the
//! right click shows no menu at all.

/// The items kept, by `WebView2`'s unlocalized item name.
const KEPT: &[&str] = &[
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "selectAll",
    "spellCheck",
];

/// Kept in debug builds only, where the developer tools are on.
const KEPT_IN_DEBUG: &[&str] = &["inspectElement"];

/// One entry of the menu `WebView2` offers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Entry<'a> {
    Separator,
    Item(&'a str),
}

fn keeps(name: &str) -> bool {
    KEPT.contains(&name) || (cfg!(debug_assertions) && KEPT_IN_DEBUG.contains(&name))
}

/// Which entries stay: the kept items, and a separator only where it still
/// divides two of them.
fn kept(entries: &[Entry<'_>]) -> Vec<bool> {
    let mut keep = vec![false; entries.len()];
    let mut any_item = false;
    let mut divider = None;
    for (index, entry) in entries.iter().enumerate() {
        match entry {
            Entry::Separator if any_item => {
                divider.get_or_insert(index);
            }
            Entry::Item(name) if keeps(name) => {
                if let Some(separator) = divider.take() {
                    keep[separator] = true;
                }
                keep[index] = true;
                any_item = true;
            }
            _ => {}
        }
    }
    keep
}

#[cfg(windows)]
pub use hook::install;

#[cfg(windows)]
mod hook {
    use webview2_com::{
        ContextMenuRequestedEventHandler,
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
            ICoreWebView2, ICoreWebView2_11, ICoreWebView2ContextMenuItem,
            ICoreWebView2ContextMenuRequestedEventArgs,
        },
        take_pwstr,
    };
    use windows::core::{Interface, PWSTR, Result};

    use super::{Entry, kept};

    /// Filters every right-click menu the webview is about to show.
    pub fn install(webview: &ICoreWebView2) -> Result<()> {
        let webview: ICoreWebView2_11 = webview.cast()?;
        let handler = ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
            args.map_or(Ok(()), |args| filter(&args))
        }));
        let mut token = 0;
        // SAFETY: a WebView2 call on the UI thread, which `with_webview` runs on.
        unsafe { webview.add_ContextMenuRequested(&handler, &raw mut token) }
    }

    /// An item's name, or `None` for a separator.
    fn describe(item: &ICoreWebView2ContextMenuItem) -> Result<Option<String>> {
        let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
        let mut name = PWSTR::null();
        // SAFETY: WebView2 calls on the UI thread; the name is ours to free,
        // which `take_pwstr` does.
        unsafe {
            item.Kind(&raw mut kind)?;
            if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                return Ok(None);
            }
            item.Name(&raw mut name)?;
        }
        Ok(Some(take_pwstr(name)))
    }

    fn filter(args: &ICoreWebView2ContextMenuRequestedEventArgs) -> Result<()> {
        // SAFETY: WebView2 calls on the UI thread, inside the event.
        let items = unsafe { args.MenuItems()? };
        let mut count = 0;
        unsafe { items.Count(&raw mut count)? };
        let names = (0..count)
            .map(|index| unsafe { items.GetValueAtIndex(index) }.and_then(|item| describe(&item)))
            .collect::<Result<Vec<_>>>()?;
        let entries: Vec<Entry<'_>> = names
            .iter()
            .map(|name| name.as_deref().map_or(Entry::Separator, Entry::Item))
            .collect();
        let keep = kept(&entries);
        for (index, _) in (0..count).zip(&keep).rev().filter(|(_, keep)| !**keep) {
            unsafe { items.RemoveValueAtIndex(index)? };
        }
        if !keep.contains(&true) {
            // Handled with no menu of the app's own: nothing shows.
            unsafe { args.SetHandled(true)? };
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{Entry, kept};

    fn items(entries: &[Entry<'_>]) -> Vec<String> {
        entries
            .iter()
            .zip(kept(entries))
            .filter(|(_, keep)| *keep)
            .map(|(entry, _)| match entry {
                Entry::Separator => "-".to_owned(),
                Entry::Item(name) => (*name).to_owned(),
            })
            .collect()
    }

    #[test]
    fn keeps_editing_and_spelling_in_a_field() {
        let menu = [
            Entry::Item("spellCheck"),
            Entry::Item("spellCheck"),
            Entry::Separator,
            Entry::Item("emoji"),
            Entry::Separator,
            Entry::Item("undo"),
            Entry::Item("redo"),
            Entry::Separator,
            Entry::Item("cut"),
            Entry::Item("copy"),
            Entry::Item("paste"),
            Entry::Item("pasteAndMatchStyle"),
            Entry::Item("selectAll"),
            Entry::Separator,
            Entry::Item("inspectElement"),
        ];
        let mut expected = vec![
            "spellCheck",
            "spellCheck",
            "-",
            "undo",
            "redo",
            "-",
            "cut",
            "copy",
            "paste",
            "selectAll",
        ];
        if cfg!(debug_assertions) {
            expected.extend(["-", "inspectElement"]);
        }
        assert_eq!(items(&menu), expected);
    }

    #[test]
    fn drops_the_browsers_page_link_and_image_items() {
        let page = [
            Entry::Item("back"),
            Entry::Item("forward"),
            Entry::Item("reload"),
            Entry::Separator,
            Entry::Item("saveAs"),
            Entry::Item("print"),
            Entry::Item("share"),
            Entry::Separator,
            Entry::Item("openLinkInNewWindow"),
            Entry::Item("copyLinkLocation"),
            Entry::Item("saveImageAs"),
        ];
        assert_eq!(items(&page), Vec::<String>::new());
    }

    #[test]
    fn keeps_copy_on_a_selection_without_stray_separators() {
        let selection = [
            Entry::Separator,
            Entry::Item("copy"),
            Entry::Separator,
            Entry::Separator,
            Entry::Item("print"),
            Entry::Separator,
        ];
        assert_eq!(items(&selection), ["copy"]);
    }
}
