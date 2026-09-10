<script lang="ts">
    import { onMount } from "svelte";
    import { getVersion } from "@tauri-apps/api/app";
    import { open, save } from "@tauri-apps/plugin-dialog";
    import { patcherApi } from "../api/patcher";
    import type { FixResult } from "../types";
    import type { Update } from "@tauri-apps/plugin-updater";
    import UpdateBanner from "./UpdateBanner.svelte";

    let {
        pendingUpdate,
        installingUpdate,
        onCheckInjectorUpdate,
        onInstallInjectorUpdate,
    }: {
        pendingUpdate: Update | null;
        installingUpdate: boolean;
        onCheckInjectorUpdate: () => Promise<"found" | "none">;
        onInstallInjectorUpdate: () => void;
    } = $props();

    let appVersion = $state("");

    let importing = $state(false);
    let exporting = $state(false);
    let fixing = $state(false);
    let checkingInjector = $state(false);
    let resultMessage = $state<string | null>(null);
    let resultIsError = $state(false);

    onMount(() => {
        getVersion().then(v => (appVersion = v));
    });

    function report(message: string, isError = false) {
        resultMessage = message;
        resultIsError = isError;
    }

    async function handleCheckInjectorUpdate() {
        resultMessage = null;
        checkingInjector = true;
        try {
            const outcome = await onCheckInjectorUpdate();
            if (outcome === "none") report("Abyss Injector est déjà à jour.");
        } catch (e) {
            report(String(e), true);
        } finally {
            checkingInjector = false;
        }
    }

    async function handleImport() {
        resultMessage = null;
        const path = await open({
            multiple: false,
            filters: [{ name: "Préréglage de plugins Abyss", extensions: ["json"] }],
        });
        if (!path || Array.isArray(path)) return;

        importing = true;
        try {
            await patcherApi.importPluginPresets(path);
            report("Préréglage importé — redémarre Abyss pour l'appliquer.");
        } catch (e) {
            report(String(e), true);
        } finally {
            importing = false;
        }
    }

    async function handleExport() {
        resultMessage = null;
        const path = await save({
            defaultPath: "abyss-plugins.json",
            filters: [{ name: "Préréglage de plugins Abyss", extensions: ["json"] }],
        });
        if (!path) return;

        exporting = true;
        try {
            await patcherApi.exportPluginPresets(path);
            report("Préréglage exporté avec succès.");
        } catch (e) {
            report(String(e), true);
        } finally {
            exporting = false;
        }
    }

    function summarizeFix(results: FixResult[]): string {
        if (results.length === 0) return "Aucune install Abyss détectée à vérifier.";
        const fixed = results.filter(r => r.fixed);
        const failed = results.filter(r => r.was_broken && !r.fixed);
        if (failed.length > 0) {
            return `Échec sur ${failed.map(r => r.branch).join(", ")} : ${failed[0].message ?? "erreur inconnue"}`;
        }
        if (fixed.length > 0) {
            return `Réparé : ${fixed.map(r => r.branch).join(", ")}. Redémarre Discord pour appliquer.`;
        }
        return "Tout est en ordre, aucune réparation nécessaire.";
    }

    async function handleFix() {
        resultMessage = null;
        fixing = true;
        try {
            const results = await patcherApi.fixAbyss();
            const failed = results.some(r => r.was_broken && !r.fixed);
            report(summarizeFix(results), failed);
        } catch (e) {
            report(String(e), true);
        } finally {
            fixing = false;
        }
    }
</script>

<div class="settings">
    <h2 class="title">Paramètres</h2>

    <div class="card">
        <div class="card-title">Préréglages de plugins</div>
        <div class="card-subtitle">Sauvegarde ou restaure l'état et les réglages de tes plugins Abyss.</div>
        <div class="card-actions">
            <button class="btn" disabled={importing} onclick={handleImport}>
                {importing ? "Import…" : "Importer un préréglage"}
            </button>
            <button class="btn" disabled={exporting} onclick={handleExport}>
                {exporting ? "Export…" : "Exporter mes préréglages"}
            </button>
        </div>
    </div>

    <div class="card">
        <div class="card-title">Réparation</div>
        <div class="card-subtitle">Vérifie les fichiers injectés et réinstalle automatiquement ce qui est cassé.</div>
        <div class="card-actions">
            <button class="btn btn--primary" disabled={fixing} onclick={handleFix}>
                {fixing ? "Vérification…" : "Fixer Abyss"}
            </button>
        </div>
    </div>

    {#if resultMessage}
        <p class="hint" class:hint--error={resultIsError}>{resultMessage}</p>
    {/if}

    {#if pendingUpdate}
        <UpdateBanner
            version={pendingUpdate.version}
            installing={installingUpdate}
            onInstall={onInstallInjectorUpdate}
        />
    {/if}

    <div class="card">
        <div class="card-title">Abyss Injector</div>
        <div class="card-subtitle">Version {appVersion || "…"}</div>
        <div class="card-actions">
            <button class="btn" disabled={checkingInjector || !!pendingUpdate} onclick={handleCheckInjectorUpdate}>
                {checkingInjector ? "Vérification…" : "Vérifier les mises à jour"}
            </button>
        </div>
        <div class="credit">Powered by Mxxq &amp; Octn dev</div>
    </div>
</div>

<style>
    .settings {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        height: 100%;
        padding: 64px 24px 24px;
        box-sizing: border-box;
        overflow-y: auto;
    }

    .title {
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

    .card {
        background: var(--surface);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-md);
        padding: var(--space-4);
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
    }

    .card-title {
        font-size: 14px;
        font-weight: 700;
        color: #fff;
    }

    .card-subtitle {
        font-size: 12px;
        color: var(--text-dim);
        margin-top: 3px;
    }

    .credit {
        font-size: 11px;
        color: var(--text-faint);
        margin-top: var(--space-2);
    }

    .card-actions {
        display: flex;
        gap: var(--space-2);
        margin-top: var(--space-4);
        flex-wrap: wrap;
    }

    .btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid var(--border-strong);
        color: #fff;
        padding: 9px 16px;
        border-radius: var(--radius-sm);
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-out);
    }

    .btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.14);
    }

    .btn:disabled {
        opacity: 0.55;
        cursor: default;
    }

    .btn--primary {
        background: var(--accent);
        border-color: transparent;
    }

    .btn--primary:hover:not(:disabled) {
        background: var(--accent-hover);
    }

    .hint {
        margin: 0;
        font-size: 12px;
        color: var(--ok);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);
        background: rgba(35, 165, 90, 0.1);
        border: 1px solid rgba(35, 165, 90, 0.3);
    }

    .hint--error {
        color: #ff8b8e;
        background: rgba(237, 66, 69, 0.08);
        border-color: rgba(237, 66, 69, 0.35);
    }
</style>
