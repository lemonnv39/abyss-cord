<script lang="ts">
    import ShinyButton from "./ShinyButton.svelte";

    let {
        version,
        installing,
        onInstall,
    }: {
        version: string;
        installing: boolean;
        onInstall: () => void;
    } = $props();
</script>

<div class="update-banner">
    <span class="update-banner__text">
        Une nouvelle version d'Abyss Injector est disponible.
    </span>
    <ShinyButton state={installing ? "loading" : "update"} {version} onClick={onInstall} />
</div>

<style>
    .update-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        background: #111214;
    }

    .update-banner__text {
        font-size: 13px;
        color: #d4d4d4;
    }
</style>
