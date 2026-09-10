<script lang="ts">
    import { onMount } from "svelte";
    import { fade } from "svelte/transition";
    import { listen } from "@tauri-apps/api/event";
    import type { Update } from "@tauri-apps/plugin-updater";

    import TitleBar from "./lib/components/TitleBar.svelte";
    import BlackHoleBackground from "./lib/components/BlackHoleBackground.svelte";
    import Splash from "./lib/components/Splash.svelte";
    import DiscordRow from "./lib/components/DiscordRow.svelte";
    import UpdateBanner from "./lib/components/UpdateBanner.svelte";
    import Settings from "./lib/components/Settings.svelte";
    import { patcherApi } from "./lib/api/patcher";
    import { checkForUpdate, installUpdate } from "./lib/api/updater";
    import type { DiscordInstall, InstallProgressEvent, RowPhase } from "./lib/types";

    let screen = $state<"splash" | "list" | "settings">("splash");
    let screenBeforeSettings: "splash" | "list" = "splash";

    let installs = $state<DiscordInstall[]>([]);
    let phases = $state<Record<string, RowPhase>>({});
    let latestBuildSha = $state<string | null>(null);
    let globalError = $state<string | null>(null);

    let pendingUpdate = $state<Update | null>(null);
    let installingUpdate = $state(false);

    let buildUpdating = $state(false);
    let buildUpdateAvailable = $state(false);

    function sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function phaseOf(branch: string): RowPhase {
        return phases[branch] ?? { kind: "idle" };
    }

    const anyInstalling = $derived(Object.values(phases).some(p => p.kind === "installing"));

    function needsUpdate(install: DiscordInstall): boolean {
        return (
            install.patch_owner === "abyss" &&
            !!install.build_sha &&
            !!latestBuildSha &&
            install.build_sha !== latestBuildSha
        );
    }

    async function refreshInstalls() {
        try {
            installs = await patcherApi.listInstalls();
        } catch (e) {
            globalError = String(e);
        }
    }

    async function runInstall(install: DiscordInstall) {
        if (!install.resources_path || !install.base_path) return;
        globalError = null;
        phases = { ...phases, [install.branch]: { kind: "installing", step: "cleaning" } };
        try {
            await patcherApi.patch(install.resources_path, install.base_path, install.branch);
            await sleep(1100);
        } catch (e) {
            if (phaseOf(install.branch).kind !== "error") {
                phases = { ...phases, [install.branch]: { kind: "error", message: String(e) } };
            }
            await sleep(2600);
        } finally {
            phases = { ...phases, [install.branch]: { kind: "idle" } };
            await refreshInstalls();
        }
    }

    async function runUninstall(install: DiscordInstall) {
        if (!install.resources_path || !install.base_path) return;
        globalError = null;
        try {
            await patcherApi.unpatch(install.resources_path, install.base_path, install.branch);
        } catch (e) {
            globalError = String(e);
        } finally {
            phases = { ...phases, [install.branch]: { kind: "idle" } };
            await refreshInstalls();
        }
    }

    async function updateAbyssBuild() {
        buildUpdating = true;
        globalError = null;
        try {
            await patcherApi.updateAbyssBuild();
            buildUpdateAvailable = false;
        } catch (e) {
            globalError = String(e);
        } finally {
            buildUpdating = false;
        }
    }

    async function doInstallUpdate() {
        if (!pendingUpdate) return;
        installingUpdate = true;
        try {
            await installUpdate(pendingUpdate);
        } catch (e) {
            globalError = String(e);
            installingUpdate = false;
        }
    }

    /// Check manuel de l'injecteur lui-même (bouton Réglages) — distinct du
    /// build Abyss (patcher.js et consorts) : ça, c'est une nouvelle version
    /// de l'appli (nouveau style, nouvelle fonctionnalité...), déclenchée à
    /// la demande plutôt que d'attendre le prochain lancement.
    async function checkInjectorUpdate(): Promise<"found" | "none"> {
        const u = await checkForUpdate();
        if (u) {
            pendingUpdate = u;
            return "found";
        }
        return "none";
    }

    onMount(() => {
        refreshInstalls();
        patcherApi.getLatestBuildSha().then(sha => { latestBuildSha = sha; });

        // Injecteur lui-même : check silencieux côté Rust (updater.rs), on ne
        // fait que récupérer l'objet Update complet ici (install reste manuel).
        const unlistenUpdate = listen<{ version: string; notes?: string }>(
            "update-available",
            () => {
                checkForUpdate().then(u => {
                    if (u) pendingUpdate = u;
                });
            },
        );

        // Contenu d'Abyss (patcher.js et consorts) : nouvelle version du
        // cache local disponible.
        const unlistenBuild = listen<{ sha: string }>(
            "abyss-build-update-available",
            () => {
                buildUpdateAvailable = true;
            },
        );

        // Dernier SHA distant connu, rafraîchi à CHAQUE lancement (voir
        // dist_fetch::spawn_silent_check) — sans ça, aucune ligne ne pourrait
        // jamais afficher "mettre à jour" avant un check manuel.
        const unlistenLatestSha = listen<{ sha: string }>(
            "latest-build-sha",
            e => { latestBuildSha = e.payload.sha; },
        );

        const unlistenProgress = listen<InstallProgressEvent>(
            "install-progress",
            e => {
                const { branch, step, status, message } = e.payload;
                if (status === "error") {
                    phases = { ...phases, [branch]: { kind: "error", message: message ?? "erreur inconnue" } };
                } else {
                    phases = { ...phases, [branch]: { kind: "installing", step } };
                }
            },
        );

        return () => {
            unlistenUpdate.then(u => u());
            unlistenBuild.then(u => u());
            unlistenLatestSha.then(u => u());
            unlistenProgress.then(u => u());
        };
    });
</script>

<div class="shell">
    <BlackHoleBackground
        zoomedOut={screen !== "splash"}
        darkened={screen !== "splash"}
        blurred={screen !== "splash"}
        lightBlur={screen === "splash"}
        dimmed={anyInstalling}
    />
    <TitleBar
        onBack={screen !== "splash" ? () => (screen = screen === "settings" ? screenBeforeSettings : "splash") : undefined}
        onSettings={screen !== "settings"
            ? () => {
                  screenBeforeSettings = screen === "list" ? "list" : "splash";
                  screen = "settings";
              }
            : undefined}
    />

    <div class="content">
        {#key screen}
        <div class="screen-transition" in:fade={{ duration: 260 }} out:fade={{ duration: 160 }}>
        {#if screen === "splash"}
            <Splash onStart={() => (screen = "list")} />
        {:else if screen === "settings"}
            <Settings
                {pendingUpdate}
                {installingUpdate}
                onCheckInjectorUpdate={checkInjectorUpdate}
                onInstallInjectorUpdate={doInstallUpdate}
            />
        {:else}
            <div class="list-screen">
                <h2 class="brand">Abyss</h2>

                {#if pendingUpdate}
                    <UpdateBanner
                        version={pendingUpdate.version}
                        installing={installingUpdate}
                        onInstall={doInstallUpdate}
                    />
                {/if}

                {#if buildUpdateAvailable}
                    <div class="banner">
                        <span>Une nouvelle version d'Abyss est disponible.</span>
                        <button disabled={buildUpdating} onclick={updateAbyssBuild}>
                            {buildUpdating ? "Téléchargement…" : "Mettre à jour"}
                        </button>
                    </div>
                {/if}

                {#if globalError}
                    <p class="error">{globalError}</p>
                {/if}

                <div class="rows-wrap">
                    <div class="rows">
                        {#each installs as install, i (install.branch)}
                            <div class="row-enter" style={`animation-delay:${i * 45}ms`}>
                                <DiscordRow
                                    {install}
                                    needsUpdate={needsUpdate(install)}
                                    phase={phaseOf(install.branch)}
                                    onInstall={() => runInstall(install)}
                                    onUninstall={() => runUninstall(install)}
                                    onConfirmUninstall={() => (phases = { ...phases, [install.branch]: { kind: "confirm-uninstall" } })}
                                    onCancelConfirm={() => (phases = { ...phases, [install.branch]: { kind: "idle" } })}
                                />
                            </div>
                        {/each}
                    </div>
                </div>
            </div>
        {/if}
        </div>
        {/key}
    </div>
</div>

<style>
    :global(html, body) {
        background: #000;
    }

    .shell {
        position: relative;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
    }

    .content {
        position: relative;
        z-index: 1;
        width: 100%;
        height: 100%;
    }

    .screen-transition {
        width: 100%;
        height: 100%;
    }

    .list-screen {
        display: flex;
        flex-direction: column;
        gap: 14px;
        height: 100%;
        padding: 64px 24px 24px;
        box-sizing: border-box;
        overflow-y: auto;
    }

    .brand {
        margin: 0 0 4px;
        font-family: "Anton", "Space Grotesk", sans-serif;
        font-size: 22px;
        font-weight: 400;
        letter-spacing: 0.01em;
        text-transform: uppercase;
        transform: skewX(-8deg);
        transform-origin: left center;
        display: inline-block;
        color: #fff;
        text-shadow: 0 0 8px rgba(255, 255, 255, 0.25);
    }

    .rows-wrap {
        position: relative;
        margin-top: auto;
        margin-bottom: auto;
        width: 100%;
        max-width: 560px;
        margin-left: auto;
        margin-right: auto;
    }

    .row-enter {
        animation: row-rise var(--duration-base) var(--ease-out) both;
    }

    @keyframes row-rise {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .rows {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-4);
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-md);
        background: var(--surface);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        font-size: 13px;
        color: var(--text);
    }

    .banner button {
        background: transparent;
        border: 1px solid var(--border-strong);
        color: #fff;
        padding: 7px 14px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
        transition: background var(--duration-fast) var(--ease-out);
    }

    .banner button:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
    }

    .banner button:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .error {
        margin: 0;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);
        border: 1px solid rgba(237, 66, 69, 0.4);
        background: rgba(237, 66, 69, 0.08);
        color: #ff8b8e;
        font-size: 12px;
    }
</style>
