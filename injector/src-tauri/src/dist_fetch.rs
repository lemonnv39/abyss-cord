/*
 * Récupère le build JS d'Abyss (patcher.js/preload.js/renderer.js/
 * renderer.css) depuis abyss-builds — un repo public alimenté automatiquement
 * par .github/workflows/publish-dist.yml du repo principal à chaque push sur
 * master — plutôt que d'exiger un clone local d'Abyss avec Node/pnpm.
 *
 * C'est ce qui permet à quelqu'un qui n'a QUE l'exe de l'injecteur (aucun
 * repo, aucun Node) de patcher son Discord : le champ "Dossier du repo
 * Abyss" dans Réglages reste possible en override pour le développement
 * local, mais n'est plus requis.
 *
 * Ce module gère aussi la détection de nouvelle version : le SHA du dernier
 * commit d'abyss-builds est mis en cache à côté des fichiers téléchargés ;
 * un check silencieux au lancement (voir spawn_silent_check) le compare au
 * SHA distant et prévient le frontend si ça a changé, séparément du check de
 * mise à jour de l'injecteur lui-même (qui, lui, passe par updater.rs).
 */

use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

const BUILD_BASE_URL: &str = "https://raw.githubusercontent.com/0ctane6/abyss-builds/master";
const COMMITS_API_URL: &str = "https://api.github.com/repos/0ctane6/abyss-builds/commits/master";
const FILES: &[&str] = &["patcher.js", "preload.js", "renderer.js", "renderer.css"];

#[derive(Deserialize)]
struct CommitResponse {
    sha: String,
}

fn dist_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("dossier de données introuvable").join("dist");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn cached_patcher_path(app: &AppHandle) -> PathBuf {
    dist_dir(app).join("patcher.js")
}

fn sha_cache_path(app: &AppHandle) -> PathBuf {
    dist_dir(app).join(".build-sha")
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent("AbyssInjector").build().map_err(|e| e.to_string())
}

async fn fetch_latest_sha(client: &reqwest::Client) -> Result<String, String> {
    let resp = client
        .get(COMMITS_API_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Échec de la vérification de version : {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Échec de la vérification de version : HTTP {}", resp.status()));
    }

    let commit: CommitResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(commit.sha)
}

async fn download_file(client: &reqwest::Client, filename: &str, dest_dir: &PathBuf) -> Result<(), String> {
    let url = format!("{BUILD_BASE_URL}/{filename}");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Échec du téléchargement de {filename} : {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Échec du téléchargement de {filename} : HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("Échec de lecture de {filename} : {e}"))?;
    fs::write(dest_dir.join(filename), &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// Télécharge la dernière version du build depuis abyss-builds et écrase le
/// cache local. Utilisé au patch quand aucun repo local n'est configuré, et
/// par le bouton "Mettre à jour le build Abyss" des Réglages.
pub async fn download_latest(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = dist_dir(app);
    let client = http_client()?;

    // Best-effort : l'API commits (limitée niveau rate-limit) est secondaire
    // par rapport au téléchargement des fichiers eux-mêmes (raw.githubusercontent,
    // bien plus permissif) — si elle échoue, on télécharge quand même, on
    // perd juste la capacité de détecter la PROCHAINE mise à jour tant que
    // le SHA n'aura pas pu être rafraîchi.
    let sha = fetch_latest_sha(&client).await.ok();

    for filename in FILES {
        download_file(&client, filename, &dir).await?;
    }

    if let Some(sha) = sha {
        let _ = fs::write(sha_cache_path(app), sha);
    }

    Ok(dir.join("patcher.js"))
}

/// Retourne le patcher.js en cache, le télécharge d'abord s'il est absent.
/// Ne revérifie PAS s'il est à jour à chaque patch (éviter un aller-retour
/// réseau à chaque clic) — l'utilisateur rafraîchit via le bouton dédié.
pub async fn ensure_downloaded(app: &AppHandle) -> Result<PathBuf, String> {
    let cached = cached_patcher_path(app);
    if cached.exists() {
        return Ok(cached);
    }
    download_latest(app).await
}

/// Compare le SHA distant à celui en cache. Ne retourne Some(...) QUE s'il y
/// a déjà un cache ET qu'il diffère — pas de "mise à jour disponible" pour
/// quelqu'un qui n'a encore jamais rien téléchargé (ça n'aurait pas de sens
/// avant même un premier patch).
pub async fn check_for_update(app: &AppHandle) -> Result<Option<String>, String> {
    let Ok(cached_sha) = fs::read_to_string(sha_cache_path(app)) else {
        return Ok(None);
    };

    let client = http_client()?;
    let remote_sha = fetch_latest_sha(&client).await?;

    if remote_sha.trim() != cached_sha.trim() {
        Ok(Some(remote_sha))
    } else {
        Ok(None)
    }
}

/// Check silencieux et non-bloquant au lancement, comme updater::spawn_silent_check
/// mais pour le CONTENU d'Abyss plutôt que pour l'injecteur lui-même —
/// n'installe/télécharge jamais rien tout seul, prévient juste le frontend.
pub fn spawn_silent_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        match check_for_update(&app).await {
            Ok(Some(sha)) => {
                let _ = app.emit("abyss-build-update-available", serde_json::json!({ "sha": sha }));
            }
            Ok(None) => {}
            Err(e) => eprintln!("[dist_fetch] check silencieux échoué : {e}"),
        }
    });
}
