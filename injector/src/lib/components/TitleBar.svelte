<script lang="ts">
    import { getCurrentWindow } from "@tauri-apps/api/window";

    const win = getCurrentWindow();

    let { onBack, onSettings }: { onBack?: () => void; onSettings?: () => void } = $props();
</script>

<!--
    Barre de titre 100% custom (decorations: false côté tauri.conf.json) —
    trois points colorés façon macOS plutôt que les boutons Windows natifs,
    demandé explicitement pour coller à la maquette. data-tauri-drag-region
    rend toute la zone déplaçable SAUF les boutons eux-mêmes (stopPropagation
    empêche le clic de démarrer un drag en plus de son action).
-->
<header class="titlebar" data-tauri-drag-region>
    {#if onBack}
        <button class="back" title="Retour à l'accueil" onclick={(e) => { e.stopPropagation(); onBack?.(); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 18l-6-6 6-6" />
            </svg>
        </button>
    {:else}
        <span></span>
    {/if}

    <div class="right-controls">
        <div class="dots">
            <button
                class="dot dot--green"
                title="Agrandir"
                onclick={(e) => { e.stopPropagation(); win.toggleMaximize(); }}
            ></button>
            <button
                class="dot dot--orange"
                title="Réduire"
                onclick={(e) => { e.stopPropagation(); win.minimize(); }}
            ></button>
            <button
                class="dot dot--red"
                title="Fermer"
                onclick={(e) => { e.stopPropagation(); win.close(); }}
            ></button>
        </div>
        {#if onSettings}
            <button class="gear" title="Paramètres" onclick={(e) => { e.stopPropagation(); onSettings?.(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            </button>
        {/if}
    </div>
</header>

<style>
    .titlebar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        /* Assez haut pour couvrir la zone du logo "Abyss" en dessous — sinon
           la seule bande réellement déplaçable (44px) est trop fine et
           invisible, personne ne pense à cliquer pile dedans pour bouger
           la fenêtre. */
        height: 90px;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 18px 18px 0;
        z-index: 10;
    }

    .back {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #fff;
        width: 30px;
        height: 30px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-out),
            transform var(--duration-fast) var(--ease-out);
    }

    .back:hover {
        background: rgba(255, 255, 255, 0.16);
        transform: translateX(-1px);
    }

    .back:active {
        transform: scale(0.94);
    }

    .right-controls {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
    }

    .dots {
        display: flex;
        gap: 8px;
    }

    .gear {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.75);
        width: 26px;
        height: 26px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-out),
            color var(--duration-fast) var(--ease-out),
            transform var(--duration-base) var(--ease-out);
    }

    .gear:hover {
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
        transform: rotate(45deg);
    }

    .gear:active {
        transform: rotate(45deg) scale(0.92);
    }

    .dot {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        border: none;
        padding: 0;
        cursor: pointer;
        opacity: 0.9;
        transition: opacity var(--duration-fast) var(--ease-out),
            transform var(--duration-fast) var(--ease-out);
    }

    .dot:hover {
        opacity: 1;
        transform: scale(1.1);
    }

    .dot--green {
        background: #2ecc71;
    }

    .dot--orange {
        background: #f5a623;
    }

    .dot--red {
        background: #ed4245;
    }
</style>
