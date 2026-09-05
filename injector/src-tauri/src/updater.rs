/*
 * Check de mise à jour silencieux au lancement — utilise le plugin officiel
 * tauri-plugin-updater (jamais un fetch GitHub API custom, cf. demande).
 * Ne télécharge/installe RIEN tout seul : si une version plus récente existe,
 * on émet juste un event que le frontend écoute pour afficher le bandeau +
 * ShinyButton en état "update". Le check manuel (bouton Settings) appelle
 * directement l'API JS du plugin, sans repasser par Rust.
 */

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Serialize)]
struct UpdateAvailablePayload {
    version: String,
    notes: Option<String>,
}

pub fn spawn_silent_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(updater) = app.updater() else { return };

        match updater.check().await {
            Ok(Some(update)) => {
                let _ = app.emit(
                    "update-available",
                    UpdateAvailablePayload { version: update.version.clone(), notes: update.body.clone() },
                );
            }
            Ok(None) => {}
            Err(e) => {
                // Non-bloquant : pas de connexion / pas de release publiée, etc.
                eprintln!("[updater] check silencieux échoué : {e}");
            }
        }
    });
}
