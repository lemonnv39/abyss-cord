import { invoke } from "@tauri-apps/api/core";
import type { DiscordInstall, InjectorSettings } from "../types";

// Fine couche au-dessus de `invoke()` : le reste du frontend ne connaît pas
// les noms exacts des commandes Tauri, juste cette API.
export const patcherApi = {
    listInstalls: () => invoke<DiscordInstall[]>("list_discord_installs"),

    // `repoPath` est un override optionnel (dev local) — omis/null, l'injecteur
    // télécharge et met en cache le dernier build public d'Abyss tout seul.
    patch: (resourcesPath: string, branch: string, repoPath?: string | null) =>
        invoke<void>("patch_discord", { resourcesPath, branch, repoPath: repoPath || null }),

    unpatch: (resourcesPath: string, branch: string) =>
        invoke<void>("unpatch_discord", { resourcesPath, branch }),

    updateAbyssBuild: () => invoke<string>("update_abyss_build"),

    checkAbyssBuildUpdate: () => invoke<string | null>("check_abyss_build_update"),

    getSettings: () => invoke<InjectorSettings>("get_settings"),

    saveSettings: (settings: InjectorSettings) =>
        invoke<void>("save_settings", { settings }),
};
