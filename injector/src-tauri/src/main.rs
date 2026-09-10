// Pas de console Windows derrière la fenêtre en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asar;
mod discord;
mod dist_fetch;
mod patcher;
mod presets;
mod settings;
mod updater;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Deux checks silencieux indépendants : l'un pour l'injecteur
            // lui-même (tauri-plugin-updater), l'autre pour le contenu
            // d'Abyss (patcher.js et consorts, via abyss-builds).
            updater::spawn_silent_check(app.handle().clone());
            dist_fetch::spawn_silent_check(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            patcher::list_discord_installs,
            patcher::patch_discord,
            patcher::unpatch_discord,
            patcher::update_abyss_build,
            patcher::check_abyss_build_update,
            patcher::get_latest_build_sha,
            patcher::fix_abyss,
            presets::export_plugin_presets,
            presets::import_plugin_presets,
            settings::get_settings,
            settings::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement d'Abyss Injector");
}
