// Miroir des structs Rust exposées par src-tauri (voir discord.rs / settings.rs).
// Les noms de champs restent en snake_case : Tauri ne les convertit PAS pour
// les objets sérialisés en retour de commande (seuls les *arguments* passés
// à `invoke()` sont convertis camelCase -> snake_case).

export interface DiscordInstall {
    id: string;
    branch: string;
    base_path: string;
    resources_path: string;
    version: string;
    is_patched: boolean;
}

export interface InjectorSettings {
    repo_path?: string | null;
}
