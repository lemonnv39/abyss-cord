<script lang="ts">
    import { onMount } from "svelte";
    import { listen } from "@tauri-apps/api/event";
    import { getVersion } from "@tauri-apps/api/app";
    import type { Update } from "@tauri-apps/plugin-updater";

    import ShinyButton from "./lib/components/ShinyButton.svelte";
    import UpdateBanner from "./lib/components/UpdateBanner.svelte";
    import { patcherApi } from "./lib/api/patcher";
    import { checkForUpdate, installUpdate } from "./lib/api/updater";
    import type { DiscordInstall } from "./lib/types";

    let tab = $state<"home" | "settings">("home");
    let installs = $state<DiscordInstall[]>([]);
    let repoPath = $state("");
    let busyId = $state<string | null>(null);
    let error = $state<string | null>(null);
    let appVersion = $state("");

    let pendingUpdate = $state<Update | null>(null);
    let checkingUpdate = $state(false);
    let installingUpdate = $state(false);

    let buildUpdating = $state(false);
    let buildMessage = $state<string | null>(null);
    let buildUpdateAvailable = $state(false);

    async function refreshInstalls() {
        try {
            installs = await patcherApi.listInstalls();
        } catch (e) {
            error = String(e);
        }
    }

    async function loadSettings() {
        const s = await patcherApi.getSettings();
        repoPath = s.repo_path ?? "";
    }

    async function saveRepoPath() {
        await patcherApi.saveSettings({ repo_path: repoPath || null });
    }

    async function togglePatch(install: DiscordInstall) {
        error = null;
        busyId = install.id;
        try {
            if (install.is_patched) {
                await patcherApi.unpatch(install.resources_path, install.branch);
            } else {
                // repoPath vide -> l'injecteur télécharge le build public
                // d'Abyss tout seul (voir dist_fetch.rs côté Rust).
                await patcherApi.patch(install.resources_path, install.branch, repoPath);
            }
            await refreshInstalls();
        } catch (e) {
            error = String(e);
        } finally {
            busyId = null;
        }
    }

    async function updateAbyssBuild() {
        buildUpdating = true;
        buildMessage = null;
        error = null;
        try {
            await patcherApi.updateAbyssBuild();
            buildMessage = "Build Abyss à jour — redémarre Discord pour l'appliquer.";
            buildUpdateAvailable = false;
        } catch (e) {
            error = String(e);
        } finally {
            buildUpdating = false;
        }
    }

    async function manualCheck() {
        checkingUpdate = true;
        error = null;
        try {
            const update = await checkForUpdate();
            if (update) {
                pendingUpdate = update;
            } else {
                error = "Abyss Injector est déjà à jour.";
            }
        } catch (e) {
            error = String(e);
        } finally {
            checkingUpdate = false;
        }
    }

    async function doInstallUpdate() {
        if (!pendingUpdate) return;
        installingUpdate = true;
        try {
            await installUpdate(pendingUpdate);
        } catch (e) {
            error = String(e);
            installingUpdate = false;
        }
    }

    onMount(() => {
        refreshInstalls();
        loadSettings();
        getVersion().then(v => (appVersion = v));

        // Le check silencieux au lancement tourne côté Rust (updater.rs) ; il
        // se contente d'émettre cet event, jamais d'installer quoi que ce
        // soit tout seul. On relance `check()` ici juste pour récupérer
        // l'objet Update complet (téléchargement/install restent manuels).
        const unlistenPromise = listen<{ version: string; notes?: string }>(
            "update-available",
            () => {
                checkForUpdate().then(u => {
                    if (u) pendingUpdate = u;
                });
            },
        );

        // Check silencieux séparé, côté Rust (dist_fetch.rs) : nouvelle
        // version du CONTENU d'Abyss (nouveaux plugins, fixes...), pas de
        // l'injecteur lui-même. N'installe jamais rien tout seul.
        const unlistenBuildPromise = listen<{ sha: string }>(
            "abyss-build-update-available",
            () => {
                buildUpdateAvailable = true;
            },
        );

        return () => {
            unlistenPromise.then(unlisten => unlisten());
            unlistenBuildPromise.then(unlisten => unlisten());
        };
    });
</script>

<main>
    <header>
        <h1>Abyss Injector</h1>
        <nav>
            <button class:active={tab === "home"} onclick={() => (tab = "home")}>
                Accueil
            </button>
            <button class:active={tab === "settings"} onclick={() => (tab = "settings")}>
                Réglages
            </button>
        </nav>
    </header>

    {#if pendingUpdate}
        <UpdateBanner
            version={pendingUpdate.version}
            installing={installingUpdate}
            onInstall={doInstallUpdate}
        />
    {/if}

    {#if buildUpdateAvailable}
        <div class="build-update-banner">
            <span>Une nouvelle version d'Abyss est disponible.</span>
            <button class="secondary" disabled={buildUpdating} onclick={updateAbyssBuild}>
                {buildUpdating ? "Téléchargement…" : "Mettre à jour"}
            </button>
        </div>
    {/if}

    {#if error}
        <p class="error">{error}</p>
    {/if}

    {#if tab === "home"}
        <section class="installs">
            {#if installs.length === 0}
                <p class="empty">Aucune installation Discord détectée.</p>
            {/if}

            {#each installs as install (install.id)}
                <div class="install-card">
                    <div class="install-card__info">
                        <strong class="branch">{install.branch}</strong>
                        <span class="version">v{install.version}</span>
                        <span class="status" class:patched={install.is_patched}>
                            {install.is_patched ? "Patché" : "Non patché"}
                        </span>
                    </div>
                    <button
                        class="patch-btn"
                        class:danger={install.is_patched}
                        disabled={busyId === install.id}
                        onclick={() => togglePatch(install)}
                    >
                        {#if busyId === install.id}
                            …
                        {:else if install.is_patched}
                            Retirer Abyss
                        {:else}
                            Injecter Abyss
                        {/if}
                    </button>
                </div>
            {/each}

            <button class="refresh" onclick={refreshInstalls}>Rafraîchir</button>
        </section>
    {:else}
        <section class="settings">
            <div class="build-block">
                <p class="build-block__hint">
                    Par défaut, Abyss Injector télécharge et met en cache le dernier build
                    public d'Abyss (aucun repo ni Node requis). Clique ici pour forcer un
                    rafraîchissement si tes amis n'ont pas la dernière version.
                </p>
                <button class="secondary" disabled={buildUpdating} onclick={updateAbyssBuild}>
                    {buildUpdating ? "Téléchargement…" : "Mettre à jour le build Abyss"}
                </button>
                {#if buildMessage}
                    <span class="build-block__msg">{buildMessage}</span>
                {/if}
            </div>

            <label class="field">
                <span>
                    Dossier du repo Abyss — optionnel, pour tester un build local plutôt
                    que le build public (contient dist/desktop/patcher.js après build)
                </span>
                <input
                    type="text"
                    bind:value={repoPath}
                    onchange={saveRepoPath}
                    placeholder="C:\Users\...\abyss-master (laisser vide sinon)"
                />
            </label>

            <div class="update-check">
                <ShinyButton state={checkingUpdate ? "loading" : "idle"} onClick={manualCheck} />
                <span class="app-version">Abyss Injector v{appVersion}</span>
            </div>
        </section>
    {/if}
</main>

<style>
    main {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 20px;
        min-height: 100vh;
    }

    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    h1 {
        font-size: 16px;
        font-weight: 700;
        margin: 0;
        letter-spacing: 0.02em;
    }

    nav {
        display: flex;
        gap: 4px;
        background: var(--bg-elevated);
        padding: 3px;
        border-radius: 8px;
        border: 1px solid var(--border);
    }

    nav button {
        background: transparent;
        border: none;
        color: var(--text-dim);
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
    }

    nav button.active {
        background: rgba(255, 255, 255, 0.1);
        color: var(--text);
    }

    .build-update-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 16px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--bg-elevated);
        font-size: 13px;
        color: var(--text);
    }

    .error {
        margin: 0;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(229, 72, 77, 0.4);
        background: rgba(229, 72, 77, 0.08);
        color: #ff8b8e;
        font-size: 12px;
    }

    .installs {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .empty {
        color: var(--text-dim);
        font-size: 13px;
    }

    .install-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--bg-elevated);
    }

    .install-card__info {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
    }

    .branch {
        text-transform: capitalize;
    }

    .version {
        color: var(--text-dim);
    }

    .status {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--border-strong);
        color: var(--text-dim);
    }

    .status.patched {
        color: var(--ok);
        border-color: rgba(74, 222, 128, 0.4);
    }

    .patch-btn {
        background: #fff;
        color: #0a0a0a;
        border: none;
        padding: 8px 14px;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }

    .patch-btn.danger {
        background: transparent;
        color: var(--danger);
        border: 1px solid rgba(229, 72, 77, 0.4);
    }

    .patch-btn:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .refresh {
        align-self: flex-start;
        background: transparent;
        border: 1px solid var(--border);
        color: var(--text-dim);
        padding: 6px 12px;
        border-radius: 7px;
        font-size: 12px;
        cursor: pointer;
    }

    .settings {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .build-block {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--bg-elevated);
    }

    .build-block__hint {
        margin: 0;
        font-size: 12px;
        color: var(--text-dim);
        line-height: 1.5;
    }

    .build-block__msg {
        font-size: 11px;
        color: var(--ok);
    }

    button.secondary {
        align-self: flex-start;
        background: transparent;
        border: 1px solid var(--border-strong);
        color: var(--text);
        padding: 7px 14px;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }

    button.secondary:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
        color: var(--text-dim);
    }

    .field input {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 8px 10px;
        border-radius: 7px;
        font-size: 12px;
    }

    .update-check {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .app-version {
        font-size: 11px;
        color: var(--text-dim);
    }
</style>
