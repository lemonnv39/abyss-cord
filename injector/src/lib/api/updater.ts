import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Check manuel (bouton Settings) — le check silencieux au lancement vit côté
// Rust (updater.rs) et notifie juste le frontend via l'event "update-available",
// qui déclenche à son tour ce même `check()` pour récupérer l'objet Update.
export async function checkForUpdate(): Promise<Update | null> {
    return await check();
}

export async function installUpdate(
    update: Update,
    onProgress?: (percent: number) => void,
): Promise<void> {
    let downloaded = 0;
    let total = 0;

    await update.downloadAndInstall(event => {
        switch (event.event) {
            case "Started":
                total = event.data.contentLength ?? 0;
                break;
            case "Progress":
                downloaded += event.data.chunkLength;
                if (total > 0 && onProgress) {
                    onProgress(Math.round((downloaded / total) * 100));
                }
                break;
        }
    });

    // Sous Windows, downloadAndInstall() ne "resolve" jamais vraiment : côté
    // Rust, l'installeur NSIS est lancé puis le process appelle lui-même
    // std::process::exit(0) avant qu'une réponse IPC ne puisse revenir ici —
    // ce relaunch() n'est donc atteint que sur macOS/Linux, où Tauri NE relance
    // PAS automatiquement l'app après install (contrairement à Windows/NSIS,
    // qui le fait lui-même via son flag /R une fois l'installation terminée).
    await relaunch();
}
