/*
 * Patch / unpatch — portée de patcher.go (Vencord/Installer) :
 *   - patch()   : tue le process de la branche visée, sauvegarde app.asar en
 *                 _app.asar, écrit un app.asar de stub qui require() le
 *                 patcher.js d'Abyss. Si déjà patché, dépatch d'abord.
 *   - unpatch() : restaure _app.asar -> app.asar.
 * Chaque étape connaît son rollback si l'étape suivante échoue, comme le Go
 * d'origine (patchAppAsar / unpatchAppAsar avec leurs `renamesDone`).
 */

use crate::asar;
use crate::dist_fetch;
use crate::discord::{self, DiscordInstall};
use std::fs;
use std::io;
use std::path::Path;
use std::thread;
use std::time::Duration;
use sysinfo::{ProcessesToUpdate, System};
use tauri::AppHandle;

fn kill_running(branch: &str) {
    let exe = discord::exe_name_for_branch(branch);

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut killed_any = false;
    for process in sys.processes().values() {
        if process.name().to_string_lossy().eq_ignore_ascii_case(exe) {
            process.kill();
            killed_any = true;
        }
    }

    if killed_any {
        // Laisse Windows relâcher les handles sur app.asar avant de le renommer.
        thread::sleep(Duration::from_millis(500));
    }
}

fn unpatch_dir(resources: &Path) -> io::Result<()> {
    let app_asar = resources.join("app.asar");
    let app_asar_tmp = resources.join("app.asar.tmp");
    let backup = resources.join("_app.asar");

    if !backup.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Aucune sauvegarde _app.asar trouvée — cette install n'est pas patchée par Abyss.",
        ));
    }

    fs::rename(&app_asar, &app_asar_tmp)?;
    if let Err(e) = fs::rename(&backup, &app_asar) {
        let _ = fs::rename(&app_asar_tmp, &app_asar);
        return Err(e);
    }
    let _ = fs::remove_file(&app_asar_tmp);

    Ok(())
}

fn patch_dir(resources: &Path, patcher_path: &str) -> io::Result<()> {
    let app_asar = resources.join("app.asar");
    let backup = resources.join("_app.asar");

    if backup.exists() {
        unpatch_dir(resources)?;
    }

    fs::rename(&app_asar, &backup)?;
    if let Err(e) = asar::write_app_asar(&app_asar, patcher_path) {
        let _ = fs::rename(&backup, &app_asar);
        return Err(e);
    }

    Ok(())
}

fn resolve_patcher_path(repo_path: &str) -> std::path::PathBuf {
    Path::new(repo_path).join("dist").join("desktop").join("patcher.js")
}

#[tauri::command]
pub fn list_discord_installs() -> Vec<DiscordInstall> {
    discord::find_discords()
}

/// `repo_path` est un override optionnel pour le développement local (pointe
/// vers un clone d'Abyss buildé à la main). Sans ça — le cas d'un ami qui n'a
/// que l'exe de l'injecteur — le patcher.js est téléchargé depuis
/// abyss-builds et mis en cache (voir dist_fetch.rs).
#[tauri::command]
pub async fn patch_discord(
    app: AppHandle,
    resources_path: String,
    branch: String,
    repo_path: Option<String>,
) -> Result<(), String> {
    let patcher_path = match repo_path.filter(|p| !p.trim().is_empty()) {
        Some(repo) => {
            let p = resolve_patcher_path(&repo);
            if !p.exists() {
                return Err(format!(
                    "patcher.js introuvable dans {} — build Abyss d'abord (node scripts/build/build.mjs --disable-updater).",
                    p.display()
                ));
            }
            p
        }
        None => dist_fetch::ensure_downloaded(&app).await?,
    };

    kill_running(&branch);
    patch_dir(Path::new(&resources_path), &patcher_path.to_string_lossy()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unpatch_discord(resources_path: String, branch: String) -> Result<(), String> {
    kill_running(&branch);
    unpatch_dir(Path::new(&resources_path)).map_err(|e| e.to_string())
}

/// Force le retéléchargement du build Abyss public (bouton dédié des
/// Réglages) — retourne le chemin en cache pour affichage/debug.
#[tauri::command]
pub async fn update_abyss_build(app: AppHandle) -> Result<String, String> {
    let path = dist_fetch::download_latest(&app).await?;
    Ok(path.display().to_string())
}

/// Check manuel (en plus du check silencieux au lancement, voir
/// dist_fetch::spawn_silent_check) — Some(sha) si une nouvelle version du
/// build Abyss existe, None si déjà à jour ou si rien n'est encore en cache.
#[tauri::command]
pub async fn check_abyss_build_update(app: AppHandle) -> Result<Option<String>, String> {
    dist_fetch::check_for_update(&app).await
}
