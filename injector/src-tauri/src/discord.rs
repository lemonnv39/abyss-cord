/*
 * Détection des installations Discord — portée du find_discord_windows.go +
 * util.go de https://github.com/Vencord/Installer (patcher officiel de
 * Vencord, en Go), puis étendue pour la refonte de l'injecteur :
 *   - EXACTEMENT 3 branches affichées, toujours dans le même ordre
 *     (stable/canary/ptb) — "Development" n'est pas montré, et une branche
 *     absente de la machine devient `installed: false` plutôt que de
 *     disparaître de la liste.
 *   - Une seule entrée par branche même si plusieurs bases (%LOCALAPPDATA%,
 *     %PROGRAMDATA%\<user>, %PROGRAMDATA%) contiennent chacune une install de
 *     cette branche — on garde la plus récente. Corrige le bug de l'ancien
 *     injecteur qui affichait Discord stable/canary en double.
 *   - `patch_owner` distingue "jamais patché" / "patché par Abyss" / "patché
 *     par autre chose" (Vencord, Equicord, un fork...) via asar::inspect_asar
 *     — avant, seule la présence de `_app.asar` était vérifiée, sans savoir
 *     QUI avait patché, ce qui rendait la ligne "Patché" trompeuse quand
 *     c'était en fait un autre mod.
 */

use crate::asar::{self, StubOwner};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PatchOwner {
    None,
    Abyss,
    Foreign,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscordInstall {
    /// Stable pour le frontend — c'est juste la branche, vu qu'il n'y en a
    /// plus qu'une entrée possible par branche.
    pub id: String,
    /// stable / canary / ptb
    pub branch: String,
    /// false si cette branche n'est installée nulle part sur la machine.
    pub installed: bool,
    pub base_path: Option<String>,
    /// Dossier `resources` de la version la plus récente trouvée.
    pub resources_path: Option<String>,
    pub version: Option<String>,
    pub patch_owner: PatchOwner,
    /// SHA du build Abyss actuellement injecté — seulement si patch_owner == Abyss.
    pub build_sha: Option<String>,
    /// Nom lisible du mod détecté si patch_owner == Foreign (ex: "Equicord").
    pub foreign_name: Option<String>,
}

/// Ordre d'affichage fixe voulu par la maquette : Discord, Canary, PTB.
const BRANCH_DIRS: &[(&str, &str)] = &[
    ("stable", "Discord"),
    ("canary", "DiscordCanary"),
    ("ptb", "DiscordPTB"),
];

pub fn exe_name_for_branch(branch: &str) -> &'static str {
    match branch {
        "stable" => "Discord.exe",
        "ptb" => "DiscordPTB.exe",
        "canary" => "DiscordCanary.exe",
        _ => "Discord.exe",
    }
}

fn candidate_bases() -> Vec<PathBuf> {
    let mut bases = Vec::new();

    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        bases.push(PathBuf::from(local_appdata));
    }
    if let Ok(program_data) = std::env::var("PROGRAMDATA") {
        let pd = PathBuf::from(&program_data);
        if let Ok(username) = std::env::var("USERNAME") {
            bases.push(pd.join(&username));
        }
        bases.push(pd);
    }

    bases
}

/// Clé de tri numérique pour "app-1.0.9256" -> [1, 0, 9256]. Les composants
/// non numériques retombent à 0 plutôt que de faire planter la comparaison.
fn version_key(version: &str) -> Vec<u64> {
    version.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect()
}

struct RawInstall {
    base_path: PathBuf,
    resources_path: PathBuf,
    version: String,
}

fn parse_install(base: &Path) -> Option<RawInstall> {
    let entries = fs::read_dir(base).ok()?;

    let mut best: Option<(Vec<u64>, PathBuf, String)> = None;

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(version) = name.strip_prefix("app-") else { continue };

        let resources = entry.path().join("resources");
        if !resources.is_dir() {
            continue;
        }
        // Ni app.asar ni _app.asar -> dossier de build cassé/incomplet, on l'ignore.
        if !resources.join("app.asar").exists() && !resources.join("_app.asar").exists() {
            continue;
        }

        let key = version_key(version);
        let is_newer = match &best {
            Some((best_key, _, _)) => key > *best_key,
            None => true,
        };
        if is_newer {
            best = Some((key, resources, version.to_string()));
        }
    }

    let (_, resources_path, version) = best?;
    Some(RawInstall { base_path: base.to_path_buf(), resources_path, version })
}

fn foreign_label(require_path: &str) -> String {
    let lower = require_path.to_lowercase();
    if lower.contains("equicord") {
        "Equicord".to_string()
    } else if lower.contains("vencord") {
        "Vencord".to_string()
    } else {
        "un autre mod".to_string()
    }
}

fn build_install(branch: &str, dirname: &str, our_patcher_path: &Path) -> DiscordInstall {
    // Une install par base candidate pour cette branche, on garde la plus
    // récente si plusieurs bases en contiennent une (fix "en double").
    let best = candidate_bases()
        .into_iter()
        .filter_map(|base| parse_install(&base.join(dirname)))
        .max_by_key(|r| version_key(&r.version));

    let Some(raw) = best else {
        return DiscordInstall {
            id: branch.to_string(),
            branch: branch.to_string(),
            installed: false,
            base_path: None,
            resources_path: None,
            version: None,
            patch_owner: PatchOwner::None,
            build_sha: None,
            foreign_name: None,
        };
    };

    let app_asar = raw.resources_path.join("app.asar");
    let (patch_owner, build_sha, foreign_name) = match asar::inspect_asar(&app_asar, our_patcher_path) {
        Ok(StubOwner::Genuine) => (PatchOwner::None, None, None),
        Ok(StubOwner::Abyss { build_sha }) => (PatchOwner::Abyss, build_sha, None),
        Ok(StubOwner::Foreign { require_path }) => (PatchOwner::Foreign, None, Some(foreign_label(&require_path))),
        // app.asar illisible (droits, fichier verrouillé...) : on ne sait pas,
        // mais _app.asar existant reste le signal le plus fiable qu'un patch
        // (de qui que ce soit) est en place.
        Err(_) => {
            if raw.resources_path.join("_app.asar").exists() {
                (PatchOwner::Foreign, None, Some("un autre mod".to_string()))
            } else {
                (PatchOwner::None, None, None)
            }
        }
    };

    DiscordInstall {
        id: branch.to_string(),
        branch: branch.to_string(),
        installed: true,
        base_path: Some(raw.base_path.display().to_string()),
        resources_path: Some(raw.resources_path.display().to_string()),
        version: Some(raw.version),
        patch_owner,
        build_sha,
        foreign_name,
    }
}

pub fn find_discords(our_patcher_path: &Path) -> Vec<DiscordInstall> {
    BRANCH_DIRS
        .iter()
        .map(|(branch, dirname)| build_install(branch, dirname, our_patcher_path))
        .collect()
}
