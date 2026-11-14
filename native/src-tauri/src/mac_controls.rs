//! On the Mac, the round picker between its previous and next buttons
//! (`RoundStepper` on the site) draws as one of the group, rather than as
//! the system's popup button with its darker capsule: the field's own color
//! and border, and the site's chevron (its icon set's `chevron-down`) in
//! the muted text color of each mode. The console paints its fields with a
//! `background` shorthand marked `!important`, so the chevron's parts are
//! marked too, and `:root` outweighs it.

/// The chevron in a mode's muted text color (`--muted` in the design
/// package's tokens.css), as a CSS image.
fn chevron(color: &str) -> String {
    format!(
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' \
         fill='none' stroke='%23{color}' stroke-width='1.5' stroke-linecap='round' \
         stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")"
    )
}

pub fn css() -> String {
    format!(
        ":root .tm-stepper .tm-select {{ -webkit-appearance: none; appearance: none; \
         padding-inline: 12px 32px; background-image: {light} !important; \
         background-repeat: no-repeat !important; background-position: right 10px center !important; \
         background-size: 16px 16px !important; }} \
         :root body[data-mode=\"dark\"] .tm-stepper .tm-select {{ background-image: {dark} !important; }}",
        light = chevron("50544f"),
        dark = chevron("b9b6aa"),
    )
}

#[cfg(test)]
mod tests {
    use super::css;

    #[test]
    fn draws_the_round_picker_as_one_of_its_group() {
        let css = css();
        assert!(css.contains(
            ":root .tm-stepper .tm-select { -webkit-appearance: none; appearance: none;"
        ));
        assert!(css.contains("stroke='%2350544f'") && css.contains("stroke='%23b9b6aa'"));
        assert!(css.contains("M6 9l6 6 6-6"), "the site's chevron-down");
    }
}
