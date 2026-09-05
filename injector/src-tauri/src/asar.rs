/*
 * Port fidèle de WriteAppAsar (app_asar.go, Vencord/Installer) : construit un
 * app.asar minimal dont l'unique rôle est de `require()` le vrai patcher.js
 * d'Abyss au démarrage d'Electron.
 *
 * Format ASAR (celui-ci en particulier, sans sous-dossiers ni offsets
 * multiples) : 4 entiers u32 little-endian, puis le header JSON (paddé à un
 * multiple de 4 avec des caractères '0' ASCII — pas des octets nuls, c'est
 * bien ce que fait le Go d'origine), puis le contenu des fichiers concaténé
 * dans l'ordre déclaré par le header.
 */

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Result as IoResult, Write};
use std::path::Path;

#[derive(Serialize)]
struct AsarEntry {
    size: u32,
    offset: String,
}

#[derive(Serialize)]
struct AsarHeader {
    files: BTreeMap<String, AsarEntry>,
}

const PACKAGE_JSON: &str = "{\n\t\"name\": \"discord\",\n\t\"main\": \"index.js\"\n}";

pub fn write_app_asar(out_file: &Path, patcher_path: &str) -> IoResult<()> {
    let index_js = format!("require({})", serde_json::to_string(patcher_path)?);
    let index_js_bytes = index_js.as_bytes();
    let package_json_bytes = PACKAGE_JSON.as_bytes();

    let mut files = BTreeMap::new();
    files.insert(
        "index.js".to_string(),
        AsarEntry { size: index_js_bytes.len() as u32, offset: "0".to_string() },
    );
    files.insert(
        "package.json".to_string(),
        AsarEntry {
            size: package_json_bytes.len() as u32,
            offset: index_js_bytes.len().to_string(),
        },
    );

    let mut header_string = serde_json::to_string(&AsarHeader { files })?;

    let data_size: u32 = 4;
    let header_string_size = header_string.len() as u32;
    let aligned_size = (header_string_size + data_size - 1) & !(data_size - 1);
    let header_size = aligned_size + 8;
    let header_object_size = aligned_size + data_size;

    let diff = aligned_size - header_string_size;
    if diff > 0 {
        header_string.push_str(&"0".repeat(diff as usize));
    }

    let mut f = File::create(out_file)?;
    for n in [data_size, header_size, header_object_size, header_string_size] {
        f.write_all(&n.to_le_bytes())?;
    }
    f.write_all(header_string.as_bytes())?;
    f.write_all(index_js_bytes)?;
    f.write_all(package_json_bytes)?;

    Ok(())
}
