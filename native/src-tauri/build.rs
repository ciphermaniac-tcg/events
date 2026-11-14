const TOM_COMMANDS: &[&str] = &[
    "tom_detect",
    "tom_set_path",
    "tom_launch",
    "tom_status",
    "tom_submit",
    "tom_save",
    "tom_start_round",
];

fn main() {
    // Listing the commands makes each one need a permission, granted only to
    // the local "tom" window by capabilities/tom.json.
    let manifest = tauri_build::AppManifest::new().commands(TOM_COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to run tauri-build");
}
