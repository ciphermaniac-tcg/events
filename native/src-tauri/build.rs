const COMMANDS: &[&str] = &[
    "app_theme",
    "feel_note",
    "open_big_screen",
    "title_strip_double_click",
    "tom_state",
    "tom_read",
    "tom_turn_on",
    "tom_turn_off",
    "tom_show",
    "tom_retry",
    "tom_confirm_event",
    "tom_badge",
    "tom_submit",
    "tom_start_round",
];

fn main() {
    // Listing the commands makes each one need a permission, granted to each
    // window by capabilities/.
    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to run tauri-build");
}
