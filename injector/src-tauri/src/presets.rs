/*
 * Export/import des préréglages de plugins Abyss — lit/écrit directement le
 * `settings.json` qu'Abyss (fork Vencord) maintient lui-même dans son propre
 * dossier de données, sans jamais toucher Discord en direct : seule la clé
 * "plugins" (état activé + réglages par plugin, format Vencord standard)
 * est exportée/importée, le reste de la configuration (thèmes, cloud sync,
 * langue...) n'est jamais touché.
 */

use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn settings_json_path() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "Variable APPDATA introuvable.".to_string())?;
    let path = PathBuf::from(appdata).join("Abyss").join("settings").join("settings.json");
    if !path.exists() {
        return Err(format!(
            "Fichier de settings Abyss introuvable ({}). Lance Abyss au moins une fois avant d'exporter tes plugins.",
            path.display()
        ));
    }
    Ok(path)
}

fn read_settings() -> Result<Value, String> {
    let path = settings_json_path()?;
    let raw = fs::read_to_string(&path).map_err(|e| format!("Lecture de settings.json impossible : {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("settings.json invalide : {e}"))
}

fn write_settings(value: &Value) -> Result<(), String> {
    let path = settings_json_path()?;
    let pretty = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&path, pretty).map_err(|e| format!("Écriture de settings.json impossible : {e}"))
}

/// Exporte uniquement la clé "plugins" (état + réglages de chaque plugin)
/// vers le fichier choisi par l'utilisateur — jamais le reste de la config.
#[tauri::command]
pub fn export_plugin_presets(dest_path: String) -> Result<(), String> {
    let settings = read_settings()?;
    let plugins = settings.get("plugins").cloned().unwrap_or(Value::Object(Default::default()));

    let preset = serde_json::json!({
        "abyssPluginPreset": true,
        "version": 1,
        "plugins": plugins,
    });

    let pretty = serde_json::to_string_pretty(&preset).map_err(|e| e.to_string())?;
    fs::write(&dest_path, pretty).map_err(|e| format!("Écriture du fichier impossible : {e}"))
}

/// Importe une clé "plugins" depuis un fichier exporté par cette même
/// fonction — remplace la config de plugins actuelle, ne touche à rien
/// d'autre dans settings.json (thèmes, langue, cloud...).
#[tauri::command]
pub fn import_plugin_presets(src_path: String) -> Result<(), String> {
    let raw = fs::read_to_string(&src_path).map_err(|e| format!("Lecture du fichier impossible : {e}"))?;
    let preset: Value = serde_json::from_str(&raw).map_err(|e| format!("Fichier invalide (pas du JSON) : {e}"))?;

    let plugins = preset
        .get("plugins")
        .cloned()
        .ok_or_else(|| "Ce fichier ne contient pas de préréglage de plugins Abyss valide.".to_string())?;

    let mut settings = read_settings()?;
    let Some(obj) = settings.as_object_mut() else {
        return Err("settings.json a un format inattendu.".to_string());
    };
    obj.insert("plugins".to_string(), plugins);
    write_settings(&settings)
}
