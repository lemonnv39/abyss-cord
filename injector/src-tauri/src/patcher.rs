/*
 * Patch / unpatch — portée de patcher.go (Vencord/Installer), étendue pour la
 * refonte "flux d'installation" de l'injecteur :
 *   - patch_discord() n'est plus une seule opération silencieuse : elle émet
 *     un événement Tauri "install-progress" à chaque étape (nettoyage d'un
 *     mod tiers, vérification d'environnement, écriture du patch, relance de
 *     Discord) pour que le frontend anime la ligne correspondante en direct,
 *     comme demandé dans la maquette.
 *   - Avant d'écrire le patch d'Abyss, si un AUTRE mod (Vencord, Equicord...)
 *     est détecté (voir discord::PatchOwner), on le désinstalle proprement
 *     d'abord (restauration du vrai app.asar) — plus besoin de passer par
 *     l'installeur de l'autre mod pour repartir propre.
 *   - Une fois le patch écrit, Discord.exe est relancé automatiquement via
 *     Update.exe --processStart (même technique que TokenImporter côté
 *     Abyss lui-même) plutôt que de laisser l'utilisateur le relancer à la
 *     main.
 */

use crate::asar::{self, StubOwner};
use crate::dist_fetch;
use crate::discord::{self, DiscordInstall, PatchOwner};
use crate::presets;
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;
use sysinfo::{Disks, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct ProgressEvent<'a> {
    branch: &'a str,
    step: &'a str,
    status: &'a str, // "ok" | "error"
    message: Option<String>,
}

fn emit_progress(app: &AppHandle, branch: &str, step: &str, status: &str, message: Option<String>) {
    let _ = app.emit("install-progress", ProgressEvent { branch, step, status, message });
}

fn kill_running(branch: &str) -> bool {
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
        // Laisse Windows relâcher les handles sur app.asar avant de le renommer
        // (voir aussi rename_with_retry ci-dessous, qui rattrape le cas où
        // 700ms ne suffisent pas — observé en pratique juste après une
        // relance de Discord par l'injecteur lui-même).
        thread::sleep(Duration::from_millis(700));
    }
    killed_any
}

/// Tue TOUTES les branches connues (stable/canary/ptb) d'un coup, sans savoir
/// laquelle est concernée, et retourne celles qui tournaient vraiment (pour
/// pouvoir les relancer ensuite) — utilisé pour l'import/export de
/// préréglages de plugins et le pack par défaut : `settings.json` est
/// partagé entre toutes les branches (même dossier de données Abyss), donc
/// peu importe laquelle tourne, elle peut réécrire le fichier juste après
/// notre propre écriture si on ne la ferme pas d'abord (c'est très
/// probablement le bug rapporté : l'import "ne marchait pas" parce qu'Abyss
/// tournait encore et a resauvegardé son état en mémoire par-dessus).
pub(crate) fn kill_all_known_processes() -> Vec<&'static str> {
    ["stable", "canary", "ptb"].into_iter().filter(|b| kill_running(b)).collect()
}

/// Relance chacune des branches précédemment tuées, si on retrouve encore
/// leur install sur le disque — best-effort, une branche qu'on ne relance pas
/// se relance simplement à la main par l'utilisateur.
pub(crate) fn relaunch_branches(branches: &[&str]) {
    if branches.is_empty() {
        return;
    }
    let dummy_patcher_path = PathBuf::from("__abyss_presets_relaunch_probe__");
    for install in discord::find_discords(&dummy_patcher_path) {
        if branches.contains(&install.branch.as_str()) {
            if let Some(base) = &install.base_path {
                let _ = relaunch(Path::new(base), &install.branch);
            }
        }
    }
}

/// `fs::rename` avec plusieurs tentatives : juste après avoir tué Discord (ou
/// juste après l'avoir relancé nous-mêmes puis re-tué pour un second patch
/// rapproché — le cas d'une réinjection sur une install déjà patchée fait
/// jusqu'à 3 renames à la suite, via unpatch_dir puis patch_dir), Windows peut
/// garder le fichier verrouillé plus longtemps que le délai fixe de
/// kill_running — l'antivirus qui scanne le process qui vient de sortir en
/// est une cause fréquente, et observée en vrai sur Discord Canary (échec
/// "Accès refusé (os error 5)" malgré le premier délai). Budget total
/// généreux (~6s) plutôt qu'un échec direct — un patch prend de toute façon
/// déjà plusieurs secondes, quelques secondes de retry silencieux valent
/// largement mieux qu'un message d'erreur déroutant pour l'utilisateur.
fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    let mut last_err = None;
    for attempt in 0..40 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                if attempt < 39 {
                    thread::sleep(Duration::from_millis(500));
                }
            }
        }
    }

    let err = last_err.unwrap();
    // Une "Accès refusé" qui survit ~20s de retry n'est plus le petit verrou
    // transitoire habituel (antivirus qui scanne l'exe qui vient de sortir) —
    // observé en vrai sur une toute première injection (le pire cas : un
    // exécutable totalement inconnu de Windows/l'antivirus déclenche souvent
    // une vérification cloud plus longue qu'un simple scan local). Le message
    // brut de Windows ("Accès refusé (os error 5)") ne donne aucune piste
    // concrète — remplacé par un message qui dit quoi vérifier.
    if err.raw_os_error() == Some(5) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Accès refusé après plusieurs tentatives — le fichier reste bloqué. \
            Vérifie que Discord est complètement fermé (pas juste dans la barre des tâches), \
            que ton antivirus ne bloque pas l'injecteur (regarde sa quarantaine), \
            et si Discord est installé pour tous les utilisateurs de ce PC, relance l'injecteur en tant qu'administrateur.",
        ));
    }
    Err(err)
}

fn unpatch_dir(resources: &Path) -> io::Result<()> {
    let app_asar = resources.join("app.asar");
    let app_asar_tmp = resources.join("app.asar.tmp");
    let backup = resources.join("_app.asar");

    if !backup.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Aucune sauvegarde _app.asar trouvée.",
        ));
    }

    rename_with_retry(&app_asar, &app_asar_tmp)?;
    if let Err(e) = rename_with_retry(&backup, &app_asar) {
        let _ = fs::rename(&app_asar_tmp, &app_asar);
        return Err(e);
    }
    let _ = fs::remove_file(&app_asar_tmp);

    Ok(())
}

fn patch_dir(resources: &Path, patcher_path: &str, build_sha: Option<&str>) -> io::Result<()> {
    let app_asar = resources.join("app.asar");
    let backup = resources.join("_app.asar");

    if backup.exists() {
        unpatch_dir(resources)?;
    }

    rename_with_retry(&app_asar, &backup)?;
    if let Err(e) = asar::write_app_asar(&app_asar, patcher_path, build_sha) {
        let _ = fs::rename(&backup, &app_asar);
        return Err(e);
    }

    Ok(())
}

/// Si l'install est actuellement patchée par un AUTRE mod que Abyss, restaure
/// le vrai app.asar d'origine avant de continuer — c'est ce qui évite d'avoir
/// à désinstaller Equicord/Vencord "à la main" avant de pouvoir injecter Abyss.
fn clean_foreign_patch(resources: &Path, our_patcher_path: &Path) -> io::Result<bool> {
    let app_asar = resources.join("app.asar");
    match asar::inspect_asar(&app_asar, our_patcher_path) {
        Ok(StubOwner::Foreign { .. }) => {
            unpatch_dir(resources)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// Vérifications de base avant d'écrire quoi que ce soit : dossier resources
/// bien accessible en écriture, et assez de place disque (le build d'Abyss
/// tient largement dans quelques Mo, 100 Mo de marge est trèstrès confortable
/// et évite un échec absurde sur un disque plein).
fn check_environment(resources: &Path) -> Result<(), String> {
    let probe = resources.join(".abyss-write-test");
    fs::write(&probe, b"x").map_err(|e| format!("Dossier resources non accessible en écriture : {e}"))?;
    let _ = fs::remove_file(&probe);

    const MIN_FREE_BYTES: u64 = 100 * 1024 * 1024;
    let disks = Disks::new_with_refreshed_list();
    let mut best_match: Option<(&Path, u64)> = None;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if resources.starts_with(mount) {
            let is_better = match best_match {
                Some((best, _)) => mount.as_os_str().len() > best.as_os_str().len(),
                None => true,
            };
            if is_better {
                best_match = Some((mount, disk.available_space()));
            }
        }
    }
    if let Some((_, available)) = best_match {
        if available < MIN_FREE_BYTES {
            return Err(format!(
                "Espace disque insuffisant ({} Mo libres, {} Mo requis).",
                available / (1024 * 1024),
                MIN_FREE_BYTES / (1024 * 1024)
            ));
        }
    }

    Ok(())
}

/// Relance Discord après un patch/unpatch réussi — Update.exe --processStart
/// est le lanceur Squirrel que Discord installe lui-même à côté des dossiers
/// app-X.Y.Z, donc toujours présent, même technique que le lancement d'un
/// compte local dans TokenImporter côté Abyss.
fn relaunch(base_path: &Path, branch: &str) -> io::Result<()> {
    let update_exe = base_path.join("Update.exe");
    let exe_name = discord::exe_name_for_branch(branch);
    Command::new(update_exe).arg("--processStart").arg(exe_name).spawn()?;
    Ok(())
}

#[tauri::command]
pub async fn list_discord_installs(app: AppHandle, repo_path: Option<String>) -> Vec<DiscordInstall> {
    let our_patcher_path = resolve_our_patcher_path(&app, repo_path.as_deref());
    discord::find_discords(&our_patcher_path)
}

fn resolve_patcher_path(repo_path: &str) -> PathBuf {
    Path::new(repo_path).join("dist").join("desktop").join("patcher.js")
}

/// Chemin que NOTRE patch utiliserait — sert uniquement à reconnaître nos
/// propres stubs (asar::inspect_asar), donc ne télécharge jamais rien : si
/// rien n'est en cache, on retombe sur le chemin où le téléchargement
/// atterrirait de toute façon.
fn resolve_our_patcher_path(app: &AppHandle, repo_path: Option<&str>) -> PathBuf {
    match repo_path.filter(|p| !p.trim().is_empty()) {
        Some(repo) => resolve_patcher_path(repo),
        None => dist_fetch::cached_patcher_path(app),
    }
}

/// `repo_path` est un override optionnel pour le développement local (pointe
/// vers un clone d'Abyss buildé à la main). Sans ça — le cas d'un ami qui n'a
/// que l'exe de l'injecteur — le patcher.js est téléchargé depuis la branche
/// `builds` du repo et mis en cache (voir dist_fetch.rs).
#[tauri::command]
pub async fn patch_discord(
    app: AppHandle,
    resources_path: String,
    base_path: String,
    branch: String,
    repo_path: Option<String>,
) -> Result<(), String> {
    let resources = Path::new(&resources_path);
    let base = Path::new(&base_path);

    let our_patcher_path = resolve_our_patcher_path(&app, repo_path.as_deref());

    // Capturé AVANT de patcher : settings.json est écrit par Abyss lui-même à
    // son tout premier lancement, donc "il n'existe pas encore" est le seul
    // signal fiable pour reconnaître une machine qui n'a jamais eu Abyss —
    // c'est là qu'on veut appliquer le pack de plugins par défaut, jamais sur
    // une install existante dont on écraserait les choix déjà faits.
    let is_fresh_install = !presets::settings_json_exists();

    kill_running(&branch);

    emit_progress(&app, &branch, "cleaning", "ok", None);
    let cleaned = clean_foreign_patch(resources, &our_patcher_path).map_err(|e| {
        let msg = e.to_string();
        emit_progress(&app, &branch, "cleaning", "error", Some(msg.clone()));
        msg
    })?;
    if cleaned {
        // Laisse les handles se relâcher après la restauration avant de re-toucher au dossier.
        thread::sleep(Duration::from_millis(200));
    }

    emit_progress(&app, &branch, "checking", "ok", None);
    if let Err(msg) = check_environment(resources) {
        emit_progress(&app, &branch, "checking", "error", Some(msg.clone()));
        return Err(msg);
    }
    emit_progress(&app, &branch, "checked", "ok", None);

    emit_progress(&app, &branch, "installing", "ok", None);
    let (patcher_path, build_sha) = match repo_path.filter(|p| !p.trim().is_empty()) {
        Some(repo) => {
            let p = resolve_patcher_path(&repo);
            if !p.exists() {
                let msg = format!(
                    "patcher.js introuvable dans {} — build Abyss d'abord (node scripts/build/build.mjs --disable-updater).",
                    p.display()
                );
                emit_progress(&app, &branch, "installing", "error", Some(msg.clone()));
                return Err(msg);
            }
            (p, None)
        }
        None => match dist_fetch::ensure_downloaded(&app).await {
            Ok(p) => {
                let sha = dist_fetch::cached_sha(&app);
                (p, sha)
            }
            Err(e) => {
                emit_progress(&app, &branch, "installing", "error", Some(e.clone()));
                return Err(e);
            }
        },
    };

    if let Err(e) = patch_dir(resources, &patcher_path.to_string_lossy(), build_sha.as_deref()) {
        let msg = e.to_string();
        emit_progress(&app, &branch, "installing", "error", Some(msg.clone()));
        return Err(msg);
    }
    emit_progress(&app, &branch, "installed", "ok", None);

    emit_progress(&app, &branch, "restarting", "ok", None);
    kill_running(&branch);
    if let Err(e) = relaunch(base, &branch) {
        // Le patch a réussi, seule la relance auto a échoué — pas bloquant,
        // l'utilisateur peut relancer Discord lui-même.
        emit_progress(&app, &branch, "ready", "ok", Some(format!("Relance auto échouée ({e}) — relance Discord toi-même.")));
        return Ok(());
    }

    if is_fresh_install {
        apply_default_plugins_once_ready(&app, &branch);
    }

    emit_progress(&app, &branch, "ready", "ok", None);
    Ok(())
}

/// Attend que settings.json apparaisse (créé par Abyss à son tout premier
/// lancement, juste déclenché par relaunch() ci-dessus) puis lui applique le
/// pack de plugins par défaut — best-effort : si Abyss met plus de 20s à
/// démarrer ou que l'application échoue, on n'échoue pas toute l'install pour
/// autant, l'utilisateur peut toujours importer un préréglage à la main.
fn apply_default_plugins_once_ready(app: &AppHandle, branch: &str) {
    emit_progress(app, branch, "finalizing", "ok", None);

    let mut waited = Duration::ZERO;
    let timeout = Duration::from_secs(20);
    while !presets::settings_json_exists() && waited < timeout {
        thread::sleep(Duration::from_millis(500));
        waited += Duration::from_millis(500);
    }

    if !presets::settings_json_exists() {
        return;
    }

    if let Err(e) = presets::apply_default_plugins() {
        emit_progress(
            app,
            branch,
            "ready",
            "ok",
            Some(format!("Pack de plugins par défaut non appliqué : {e}")),
        );
    }
}

#[tauri::command]
pub fn unpatch_discord(resources_path: String, base_path: String, branch: String) -> Result<(), String> {
    kill_running(&branch);
    unpatch_dir(Path::new(&resources_path)).map_err(|e| e.to_string())?;
    let _ = relaunch(Path::new(&base_path), &branch);
    Ok(())
}

#[derive(Serialize)]
pub struct FixResult {
    branch: String,
    was_broken: bool,
    fixed: bool,
    message: Option<String>,
}

/// Un build cassé = un des fichiers attendus dans le cache dist est manquant
/// ou vide — arrive si un téléchargement a été interrompu, ou si l'utilisateur
/// (ou un antivirus trop zélé) a touché au dossier de cache à la main.
fn dist_files_broken(our_patcher_path: &Path) -> bool {
    let Some(dir) = our_patcher_path.parent() else { return true };
    for filename in ["patcher.js", "preload.js", "renderer.js", "renderer.css"] {
        match fs::metadata(dir.join(filename)) {
            Ok(m) if m.len() > 0 => continue,
            _ => return true,
        }
    }
    false
}

async fn repair_one(app: &AppHandle, resources: &Path, base: &Path, branch: &str) -> Result<(), String> {
    kill_running(branch);
    let patcher_path = dist_fetch::download_latest(app).await?;
    let sha = dist_fetch::cached_sha(app);
    patch_dir(resources, &patcher_path.to_string_lossy(), sha.as_deref()).map_err(|e| e.to_string())?;
    kill_running(branch);
    let _ = relaunch(base, branch);
    Ok(())
}

/// "Fixer Abyss" (Réglages) : vérifie chaque install actuellement patchée par
/// Abyss — fichiers du build présents et non vides — et répare automatiquement
/// (retéléchargement forcé + ré-écriture du stub + relance) celles qui sont
/// cassées. N'touche jamais une install non gérée par Abyss (patch_owner
/// différent de Abyss) ni les branches non installées.
#[tauri::command]
pub async fn fix_abyss(app: AppHandle) -> Result<Vec<FixResult>, String> {
    let our_patcher_path = resolve_our_patcher_path(&app, None);
    let broken = dist_files_broken(&our_patcher_path);

    let installs = discord::find_discords(&our_patcher_path);
    let mut results = Vec::new();

    for install in installs {
        if install.patch_owner != PatchOwner::Abyss {
            continue;
        }
        let (Some(resources), Some(base)) = (&install.resources_path, &install.base_path) else {
            continue;
        };

        if !broken {
            results.push(FixResult { branch: install.branch, was_broken: false, fixed: false, message: None });
            continue;
        }

        match repair_one(&app, Path::new(resources), Path::new(base), &install.branch).await {
            Ok(()) => results.push(FixResult { branch: install.branch, was_broken: true, fixed: true, message: None }),
            Err(e) => results.push(FixResult { branch: install.branch, was_broken: true, fixed: false, message: Some(e) }),
        }
    }

    Ok(results)
}

#[derive(Serialize)]
pub struct UpdateResult {
    branch: String,
    updated: bool,
    message: Option<String>,
}

/// Retélécharge le build Abyss public ET réinjecte chaque install déjà
/// patchée par Abyss avec ce nouveau build (bouton "mettre à jour" de la
/// bannière liste).
///
/// Avant ce fix, cette commande ne faisait QUE rafraîchir le cache — elle ne
/// touchait à aucun app.asar déjà patché. Le bouton semblait pourtant
/// "réussir" (spinner puis bannière qui disparaît), donnant l'impression
/// fausse que la mise à jour était appliquée, alors qu'il fallait en plus
/// aller cliquer sur CHAQUE ligne Discord individuellement pour vraiment
/// réinjecter — un ami a fini bloqué avec le statut "mettre à jour" qui ne
/// bougeait jamais et aucun nouveau plugin, faute de connaître cette
/// deuxième étape cachée.
#[tauri::command]
pub async fn update_abyss_build(app: AppHandle) -> Result<Vec<UpdateResult>, String> {
    let patcher_path = dist_fetch::download_latest(&app).await?;
    let sha = dist_fetch::cached_sha(&app);

    let our_patcher_path = resolve_our_patcher_path(&app, None);
    let installs = discord::find_discords(&our_patcher_path);

    let mut results = Vec::new();
    for install in installs {
        if install.patch_owner != PatchOwner::Abyss {
            continue;
        }
        let (Some(resources), Some(base)) = (&install.resources_path, &install.base_path) else {
            continue;
        };

        kill_running(&install.branch);
        let outcome = patch_dir(Path::new(resources), &patcher_path.to_string_lossy(), sha.as_deref());
        kill_running(&install.branch);
        let _ = relaunch(Path::new(base), &install.branch);

        match outcome {
            Ok(()) => results.push(UpdateResult { branch: install.branch, updated: true, message: None }),
            Err(e) => results.push(UpdateResult { branch: install.branch, updated: false, message: Some(e.to_string()) }),
        }
    }

    Ok(results)
}

/// Check manuel (en plus du check silencieux au lancement, voir
/// dist_fetch::spawn_silent_check) — Some(sha) si une nouvelle version du
/// build Abyss existe, None si déjà à jour ou si rien n'est encore en cache.
#[tauri::command]
pub async fn check_abyss_build_update(app: AppHandle) -> Result<Option<String>, String> {
    dist_fetch::check_for_update(&app).await
}

/// Dernier SHA distant connu (rafraîchi au lancement, voir
/// dist_fetch::spawn_silent_check) — sert au frontend à calculer "à jour" /
/// "mettre à jour" par ligne en comparant à `DiscordInstall.build_sha`. Filet
/// de sécurité en plus de l'event "latest-build-sha" au cas où le listener
/// s'attache après l'émission au lancement.
#[tauri::command]
pub fn get_latest_build_sha(app: AppHandle) -> Option<String> {
    dist_fetch::latest_known_sha(&app)
}
