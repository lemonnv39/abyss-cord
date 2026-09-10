<script lang="ts">
    import MorphingText from "./MorphingText.svelte";

    let { onStart }: { onStart: () => void } = $props();

    const taglines = [
        { text: "Plus léger. Plus rapide. Plus stable." },
        { text: "Un client Discord repensé de zéro" },
        { text: "Des dizaines de plugins, un seul client" },
        { text: "Personnalisez chaque recoin de Discord" },
        { text: "Performance et confidentialité, sans compromis" },
        { text: "Discord, débridé" },
        { text: "Développé par Mxxq et Octn dev", duration: 6500 },
    ];
</script>

<div class="splash">
    <div class="center">
        <span class="eyebrow">Abyss Injector</span>
        <div class="logo-wrap">
            <svg class="ring" viewBox="0 0 460 170" aria-hidden="true">
                <defs>
                    <linearGradient id="ringFade" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#000000" stop-opacity="0" />
                        <stop offset="50%" stop-color="#000000" stop-opacity="0.95" />
                        <stop offset="100%" stop-color="#000000" stop-opacity="0" />
                    </linearGradient>
                </defs>
                <ellipse class="ring-track" cx="230" cy="85" rx="195" ry="30" />
                <ellipse class="ring-sweep" cx="230" cy="85" rx="195" ry="30" stroke="url(#ringFade)" />
            </svg>
            <h1 class="logo">Abyss</h1>
        </div>
        <MorphingText items={taglines} />
        <button class="start-btn" onclick={onStart}>
            <span>Commencer avec Abyss</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
            </svg>
        </button>
    </div>
</div>

<style>
    .splash {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .center {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        text-align: center;
        padding: 56px 64px;
        animation: rise var(--duration-slow) var(--ease-out) both;
    }

    /* Zone d'ombre abstraite derrière le contenu — pas de cadre/carte, deux
       flaques sombres asymétriques et floutées pour détacher le texte de la
       vidéo sans jamais dessiner de bordure visible. */
    .center::before {
        content: "";
        position: absolute;
        inset: -70px -60px;
        z-index: -1;
        background:
            radial-gradient(ellipse 48% 78% at 38% 42%, rgba(0, 0, 0, 0.78) 0%, rgba(0, 0, 0, 0) 72%),
            radial-gradient(ellipse 42% 70% at 64% 58%, rgba(0, 0, 0, 0.68) 0%, rgba(0, 0, 0, 0) 75%),
            radial-gradient(ellipse 60% 92% at 50% 50%, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0) 82%);
        filter: blur(8px);
        pointer-events: none;
    }

    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .eyebrow {
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--text-faint);
        margin-bottom: 2px;
    }

    .logo-wrap {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    /* Anneau façon Saturne — une piste elliptique fixe et discrète, avec un
       arc lumineux qui orbite dessus en continu (stroke-dashoffset animé)
       plutôt qu'une rotation brute de l'ellipse, qui déformerait visuellement
       l'inclinaison au lieu de donner une impression d'orbite. */
    .ring {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 310px;
        height: 96px;
        transform: translate(-50%, -50%) rotate(-6deg);
        overflow: visible;
        pointer-events: none;
        z-index: -1;
    }

    .ring-track {
        fill: none;
        stroke: rgba(255, 255, 255, 0.14);
        stroke-width: 1.5;
    }

    .ring-sweep {
        fill: none;
        stroke-width: 2.5;
        stroke-linecap: round;
        stroke-dasharray: 140 720;
        filter: drop-shadow(0 0 5px rgba(0, 0, 0, 0.95)) drop-shadow(0 0 12px rgba(0, 0, 0, 0.7));
        animation: orbit 7s linear infinite;
    }

    @keyframes orbit {
        to {
            stroke-dashoffset: -860;
        }
    }

    .logo {
        margin: 0;
        font-family: "Anton", "Space Grotesk", sans-serif;
        font-size: 52px;
        font-weight: 400;
        letter-spacing: 0.01em;
        text-transform: uppercase;
        transform: skewX(-8deg);
        color: #fff;
        text-shadow:
            0 0 8px rgba(255, 255, 255, 0.5),
            0 0 22px rgba(255, 255, 255, 0.25),
            0 0 50px rgba(255, 255, 255, 0.12);
    }

    .start-btn {
        margin-top: var(--space-4);
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        background: var(--surface);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid var(--border-strong);
        color: #fff;
        padding: 12px 22px;
        border-radius: var(--radius-md);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-out),
            border-color var(--duration-fast) var(--ease-out),
            box-shadow var(--duration-fast) var(--ease-out),
            transform var(--duration-fast) var(--ease-out);
    }

    .start-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(125, 216, 255, 0.4);
        box-shadow: 0 0 24px rgba(125, 216, 255, 0.18);
        transform: translateY(-1px);
    }

    .start-btn:active {
        transform: scale(0.97);
    }

    .start-btn svg {
        transition: transform var(--duration-fast) var(--ease-out);
    }

    .start-btn:hover svg {
        transform: translateX(2px);
    }
</style>
