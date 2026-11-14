const COMMANDS: &[&str] = &[
    "app_theme",
    "title_strip_double_click",
    "tom_detect",
    "tom_set_path",
    "tom_launch",
    "tom_status",
    "tom_submit",
    "tom_save",
    "tom_start_round",
];

fn main() {
    // Listing the commands makes each one need a permission, granted to each
    // window by capabilities/.
    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to run tauri-build");
}
