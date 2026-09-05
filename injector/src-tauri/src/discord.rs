/*
 * Détection des installations Discord — portée du find_discord_windows.go +
 * util.go de https://github.com/Vencord/Installer (patcher officiel de
 * Vencord, en Go). Logique d'origine :
 *   - une install par branche vit dans %LOCALAPPDATA%\<Discord|DiscordPTB|
 *     DiscordCanary|DiscordDevelopment>
 *   - chaque install contient un ou plusieurs dossiers `app-<version>`,
 *     seul le plus récent compte (le vrai binaire lancé par le raccourci)
 *   - "patché" == `resources/_app.asar` existe (c'est la sauvegarde de
 *     l'app.asar d'origine, déplacée là par patch())
 *
 * Deux écarts assumés par rapport au Go d'origine :
 *   1. Comparaison de version : le Go compare les noms de dossier `app-X.Y.Z`
 *      comme de simples chaînes (`app > appPath`), ce qui trie mal dès qu'un
 *      composant de version dépasse un chiffre (ex: "app-9" > "app-10" en
 *      comparaison de chaînes). On compare ici les composants numériques.
 *   2. Bases scannées : Vencord ne regarde que %LOCALAPPDATA%. Sur cette
 *      machine, Discord/DiscordCanary sont installés dans
 *      C:\ProgramData\<user>\ (install partagée/portable), donc on élargit
 *      la recherche à %LOCALAPPDATA% ET %PROGRAMDATA%\<user> ET %PROGRAMDATA%.
 */

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct DiscordInstall {
    /// Identifiant stable pour le frontend (branche + chemin de base).
    pub id: String,
    /// stable / ptb / canary / development
    pub branch: String,
    pub base_path: String,
    /// Dossier `resources` de la version la plus récente trouvée.
    pub resources_path: String,
    pub version: String,
    pub is_patched: bool,
}

const BRANCH_DIRS: &[(&str, &str)] = &[
    ("stable", "Discord"),
    ("ptb", "DiscordPTB"),
    ("canary", "DiscordCanary"),
    ("development", "DiscordDevelopment"),
];

pub fn exe_name_for_branch(branch: &str) -> &'static str {
    match branch {
        "stable" => "Discord.exe",
        "ptb" => "DiscordPTB.exe",
        "canary" => "DiscordCanary.exe",
        "development" => "DiscordDevelopment.exe",
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

fn parse_install(base: &Path, branch: &str) -> Option<DiscordInstall> {
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
    let is_patched = resources_path.join("_app.asar").exists();

    Some(DiscordInstall {
        id: format!("{branch}:{}", base.display()),
        branch: branch.to_string(),
        base_path: base.display().to_string(),
        resources_path: resources_path.display().to_string(),
        version,
        is_patched,
    })
}

pub fn find_discords() -> Vec<DiscordInstall> {
    let mut found = Vec::new();
    let mut seen_resources = std::collections::HashSet::new();

    for base in candidate_bases() {
        for (branch, dirname) in BRANCH_DIRS {
            let path = base.join(dirname);
            if let Some(install) = parse_install(&path, branch) {
                // Évite les doublons quand plusieurs bases pointent vers la
                // même install réelle (rare, mais possible selon la config).
                if seen_resources.insert(install.resources_path.clone()) {
                    found.push(install);
                }
            }
        }
    }

    found
}
