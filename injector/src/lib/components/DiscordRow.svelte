<script lang="ts">
    import type { DiscordInstall, InstallProgressEvent, RowPhase } from "../types";

    let {
        install,
        needsUpdate,
        phase,
        onInstall,
        onUninstall,
        onConfirmUninstall,
        onCancelConfirm,
    }: {
        install: DiscordInstall;
        needsUpdate: boolean;
        phase: RowPhase;
        onInstall: () => void;
        onUninstall: () => void;
        onConfirmUninstall: () => void;
        onCancelConfirm: () => void;
    } = $props();

    const BRANCH_LABEL: Record<string, string> = {
        stable: "Discord",
        canary: "Discord canary",
        ptb: "Discord PTB",
    };

    const BRANCH_COLOR: Record<string, string> = {
        stable: "#5865f2",
        canary: "#faa61a",
        ptb: "#7289da",
    };

    const label = $derived(BRANCH_LABEL[install.branch] ?? install.branch);
    const iconColor = $derived(BRANCH_COLOR[install.branch] ?? "#5865f2");

    const injected = $derived(install.patch_owner === "abyss");
    const actionable = $derived(install.installed && phase.kind === "idle");

    let hovering = $state(false);

    // Étapes d'installation affichées "Agent Abyss : ..." — deux segments
    // (préfixe + partie colorée) plutôt que du HTML brut injecté.
    const STEP_TEXT: Record<InstallProgressEvent["step"], { prefix: string; highlight: string; color: string }> = {
        cleaning: { prefix: "Agent Abyss : suppression des ", highlight: "anciens mods...", color: "var(--danger)" },
        checking: { prefix: "Agent Abyss : vérification de ", highlight: "l'environnement...", color: "var(--warning)" },
        checked: { prefix: "Agent Abyss : ", highlight: "environnement validé", color: "var(--ok)" },
        installing: { prefix: "Agent Abyss : ", highlight: "introduction d'Abyss...", color: "" },
        installed: { prefix: "Agent Abyss : ", highlight: "installation réussie...", color: "var(--ok)" },
        restarting: { prefix: "Agent Abyss : ", highlight: "redémarrage de Discord...", color: "" },
        ready: { prefix: "Agent Abyss : ", highlight: "Discord prêt à l'emploi...", color: "var(--ok)" },
    };

    function handleIconClick() {
        if (!actionable) return;
        onInstall();
    }

    function handleStatusClick() {
        if (phase.kind !== "idle") return;
        if (injected && !needsUpdate) {
            onConfirmUninstall();
        } else if (injected && needsUpdate) {
            onInstall();
        }
    }
</script>

<div class="row">
    <button
        class="icon"
        style={`--branch-color:${iconColor}`}
        disabled={!actionable}
        onmouseenter={() => (hovering = true)}
        onmouseleave={() => (hovering = false)}
        onclick={handleIconClick}
        title={actionable ? "Installer Abyss" : ""}
    >
        {#if actionable && hovering}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v12" />
                <path d="M6 11l6 6 6-6" />
                <path d="M5 21h14" />
            </svg>
        {:else}
            <svg width="20" height="20" viewBox="0 0 245 240" fill="currentColor">
                <path d="M104.4 103.9c-5.7 0-10.2 5-10.2 11.1s4.6 11.1 10.2 11.1c5.7 0 10.2-5 10.2-11.1.1-6.1-4.5-11.1-10.2-11.1zM140.9 103.9c-5.7 0-10.2 5-10.2 11.1s4.6 11.1 10.2 11.1c5.7 0 10.3-5 10.3-11.1s-4.6-11.1-10.3-11.1z" />
                <path d="M189.5 20h-134C44.2 20 35 29.2 35 40.6v135.2c0 11.4 9.2 20.6 20.5 20.6h113.4l-5.3-18.5 12.8 11.9 12.1 11.2 21.5 19V40.6c0-11.4-9.2-20.6-20.5-20.6zm-38.6 130.6s-3.6-4.3-6.6-8.1c13.1-3.7 18.1-11.9 18.1-11.9-4.1 2.7-8 4.6-11.5 5.9-5 2.1-9.8 3.5-14.5 4.3-9.6 1.8-18.4 1.3-25.9-.1-5.7-1.1-10.6-2.6-14.7-4.3-2.3-.9-4.8-2-7.3-3.4-.3-.2-.6-.3-.9-.5-.2-.1-.3-.2-.4-.3-1.8-1-2.8-1.7-2.8-1.7s4.8 8 17.5 11.8c-3 3.8-6.7 8.3-6.7 8.3-22.1-.7-30.5-15.2-30.5-15.2 0-32.2 14.4-58.3 14.4-58.3 14.4-10.8 28.1-10.5 28.1-10.5l1 1.2c-18 5.2-26.3 13.1-26.3 13.1s2.2-1.2 5.9-2.9c10.7-4.7 19.2-6 22.7-6.3.6-.1 1.1-.2 1.7-.2 6.1-.8 13-1 20.2-.2 9.5 1.1 19.7 3.9 30.1 9.6 0 0-7.9-7.5-24.9-12.7l1.4-1.6s13.7-.3 28.1 10.5c0 0 14.4 26.1 14.4 58.3z" />
            </svg>
        {/if}
    </button>

    <div class="status-box" class:clickable={phase.kind === "idle" && injected}>
        {#if phase.kind === "installing"}
            {@const s = STEP_TEXT[phase.step]}
            <span class="status-text">
                {s.prefix}<span style={s.color ? `color:${s.color}` : ""}>{s.highlight}</span>
            </span>
        {:else if phase.kind === "error"}
            <span class="status-text" style="color:var(--danger)">Agent Abyss : échec — {phase.message}</span>
        {:else if phase.kind === "confirm-uninstall"}
            <div class="confirm">
                <span class="status-text">Retirer Abyss de {label} ?</span>
                <button class="confirm-btn confirm-btn--danger" onclick={onUninstall}>Désinstaller</button>
                <button class="confirm-btn" onclick={onCancelConfirm}>Annuler</button>
            </div>
        {:else if !install.installed}
            <span class="status-text status-text--dim">{label} : vous n'avez pas installé {label.toLowerCase()}.</span>
        {:else if injected}
            <button class="status-text status-text--link" onclick={handleStatusClick}>
                {label} : Abyss injecté [statut :
                <span style={`color:${needsUpdate ? "var(--warning)" : "var(--ok)"}`}>
                    {needsUpdate ? " mettre à jour" : " à jour"}
                </span>]
            </button>
        {:else}
            <span class="status-text status-text--dim">{label} : Abyss non injecté...</span>
        {/if}
    </div>
</div>

<style>
    .row {
        display: flex;
        align-items: center;
        gap: var(--space-4);
    }

    .icon {
        flex-shrink: 0;
        width: 46px;
        height: 46px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: #0b0b0d;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: default;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
        transition: background var(--duration-fast) var(--ease-out),
            border-color var(--duration-fast) var(--ease-out),
            transform var(--duration-fast) var(--ease-out),
            box-shadow var(--duration-fast) var(--ease-out);
    }

    .icon :global(svg) {
        color: var(--branch-color);
        transition: color var(--duration-fast) var(--ease-out);
    }

    .icon:not(:disabled) {
        cursor: pointer;
    }

    /* Repos : bouton noir neutre avec le glyphe teinté par branche. Survol :
       s'allume — fond légèrement éclairci, lueur colorée qui déborde, glyphe
       qui passe au blanc — pour lire clairement "action disponible ici". */
    .icon:not(:disabled):hover {
        background: #1a1a1e;
        border-color: color-mix(in srgb, var(--branch-color) 55%, transparent);
        transform: scale(1.06);
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--branch-color) 45%, transparent),
            0 0 22px 4px color-mix(in srgb, var(--branch-color) 55%, transparent),
            0 4px 16px rgba(0, 0, 0, 0.5);
    }

    .icon:not(:disabled):active {
        transform: scale(0.96);
    }

    .icon:not(:disabled):hover :global(svg) {
        color: #ffffff;
    }

    .icon:disabled {
        opacity: 0.45;
    }

    .status-box {
        flex: 1;
        min-width: 0;
        background: var(--surface);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-md);
        padding: 14px 16px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
        transition: border-color var(--duration-fast) var(--ease-out),
            box-shadow var(--duration-fast) var(--ease-out);
    }

    .status-box.clickable:hover {
        border-color: rgba(125, 216, 255, 0.35);
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35), 0 0 20px rgba(125, 216, 255, 0.12);
    }

    .status-text {
        font-size: 13.5px;
        font-weight: 600;
        color: #ffffff;
        letter-spacing: -0.005em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
    }

    .status-text--dim {
        color: var(--text-faint);
    }

    button.status-text--link {
        background: none;
        border: none;
        padding: 0;
        text-align: left;
        width: 100%;
        cursor: pointer;
        font-family: inherit;
    }

    .confirm {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
    }

    .confirm-btn {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid var(--border-strong);
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        padding: 7px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        flex-shrink: 0;
        transition: background var(--duration-fast) var(--ease-out);
    }

    .confirm-btn:hover {
        background: rgba(255, 255, 255, 0.16);
    }

    .confirm-btn--danger {
        background: var(--danger);
        border-color: transparent;
    }

    .confirm-btn--danger:hover {
        background: #d63c3f;
    }
</style>
