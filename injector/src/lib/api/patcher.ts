import { invoke } from "@tauri-apps/api/core";
import type { DiscordInstall, FixResult, InjectorSettings, UpdateResult } from "../types";

// Fine couche au-dessus de `invoke()` : le reste du frontend ne connaît pas
// les noms exacts des commandes Tauri, juste cette API.
export const patcherApi = {
    // `repoPath` est un override optionnel (dev local) — omis/null, l'injecteur
    // télécharge et met en cache le dernier build public d'Abyss tout seul.
    // Sert aussi à reconnaître nos propres stubs déjà en place (voir discord.rs).
    listInstalls: (repoPath?: string | null) =>
        invoke<DiscordInstall[]>("list_discord_installs", { repoPath: repoPath || null }),

    patch: (resourcesPath: string, basePath: string, branch: string, repoPath?: string | null) =>
        invoke<void>("patch_discord", { resourcesPath, basePath, branch, repoPath: repoPath || null }),

    unpatch: (resourcesPath: string, basePath: string, branch: string) =>
        invoke<void>("unpatch_discord", { resourcesPath, basePath, branch }),

    updateAbyssBuild: () => invoke<UpdateResult[]>("update_abyss_build"),

    checkAbyssBuildUpdate: () => invoke<string | null>("check_abyss_build_update"),

    getLatestBuildSha: () => invoke<string | null>("get_latest_build_sha"),

    getSettings: () => invoke<InjectorSettings>("get_settings"),

    saveSettings: (settings: InjectorSettings) =>
        invoke<void>("save_settings", { settings }),

    fixAbyss: () => invoke<FixResult[]>("fix_abyss"),

    exportPluginPresets: (destPath: string) =>
        invoke<void>("export_plugin_presets", { destPath }),

    importPluginPresets: (srcPath: string) =>
        invoke<void>("import_plugin_presets", { srcPath }),
};
