//! The links in a page's meta line (an event's "Public page · Big screen",
//! the dashboard's stores and "Apply for a store") read as a web page's
//! with their underline at rest. In the app they are set apart by the
//! accent color alone, and take the underline under the pointer.

/// `!important` wins over the site's underline for these links.
pub const CSS: &str = "\
:root .hero-meta a { text-decoration: none !important; } \
@media (hover: hover) { :root .hero-meta a:hover { text-decoration: underline !important; \
text-decoration-color: currentColor !important; text-underline-offset: 3px; } }";

#[cfg(test)]
mod tests {
    use super::CSS;

    #[test]
    fn underlines_meta_links_only_under_the_pointer() {
        assert!(CSS.contains(":root .hero-meta a { text-decoration: none !important; }"));
        assert!(CSS.contains(":root .hero-meta a:hover { text-decoration: underline !important;"));
    }
}
