//! A button, tab, menu item or chip held down dims where it stands, as a
//! native control does, instead of shrinking as it does on the site. The
//! change is immediate, both ways.

/// `!important` wins over the site's own press scale and transitions.
pub const CSS: &str = "\
:is(button, .btn, [role=\"tab\"], [role=\"menuitem\"], .chip):active:not(:disabled) \
{ opacity: 0.55 !important; transform: none !important; transition: none !important; }";

#[cfg(test)]
mod tests {
    use super::CSS;

    #[test]
    fn dims_a_held_control_without_shrinking_it() {
        assert!(CSS.contains(":active:not(:disabled)"));
        assert!(CSS.contains("opacity: 0.55"));
        assert!(CSS.contains("transform: none !important"));
    }
}
