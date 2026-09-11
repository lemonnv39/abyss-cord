<script lang="ts">
    // Vidéo fournie par l'utilisateur (voir src/assets/splash-video.mp4),
    // importée via Vite pour obtenir l'URL finale packagée plutôt qu'un
    // chemin absolu en dur. Même fichier que le panneau incliné de l'accueil.
    import blackholeSrc from "../../assets/splash-video.mp4";

    let {
        zoomedOut = false,
        darkened = false,
        blurred = false,
        dimmed = false,
    }: {
        // Écran liste : moins zoomé que l'accueil, pour laisser plus de vidéo
        // visible derrière les lignes d'installation plutôt qu'un plan serré.
        zoomedOut?: boolean;
        // Écran liste : voile de base plus prononcé qu'à l'accueil (laissé
        // "normal" là-bas) — les lignes vivent maintenant en bas, la zone du
        // haut/milieu doit rester discrète derrière le logo.
        darkened?: boolean;
        // Flou + léger assombrissement sur la vidéo elle-même — la fait
        // vraiment reculer en arrière-plan (profondeur de champ) plutôt que
        // de juste la voiler, pour que l'écran liste se sente comme un vrai
        // panneau au premier plan devant une scène qui recule.
        blurred?: boolean;
        // Assombri encore plus pendant qu'une installation tourne, pour
        // mettre le texte de progression en avant.
        dimmed?: boolean;
    } = $props();
</script>

<!--
    Fond vidéo en boucle, muet, purement décoratif — pointer-events: none
    pour ne jamais intercepter de clic destiné à l'UI posée par-dessus.
    object-fit: cover recadre proprement quel que soit le ratio de la fenêtre.
-->
<div class="black-hole" aria-hidden="true">
    <video
        class:zoomed-out={zoomedOut}
        class:blurred
        src={blackholeSrc}
        autoplay
        loop
        muted
        playsinline
        disablepictureinpicture
    ></video>
    <div class="scrim" class:darkened class:dimmed></div>
    <!-- Dégradé haut→bas additionnel : approfondit la sensation de premier
         plan/arrière-plan sans dépendre uniquement de la vidéo assombrie. -->
    {#if darkened}
        <div class="depth"></div>
    {/if}
</div>

<style>
    .black-hole {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #000000;
        pointer-events: none;
    }

    video {
        position: absolute;
        top: 50%;
        left: 50%;
        min-width: 100%;
        min-height: 100%;
        width: auto;
        height: auto;
        transform: translate(-50%, -50%) scale(1);
        object-fit: cover;
        filter: blur(0px) brightness(1);
        transition: transform var(--duration-slow) var(--ease-in-out),
            filter var(--duration-slow) var(--ease-in-out);
    }

    /* Écran liste : on recule un peu pour montrer davantage de la vidéo
       plutôt qu'un plan serré sur le tourbillon central. */
    video.zoomed-out {
        transform: translate(-50%, -50%) scale(0.8);
    }

    video.blurred {
        filter: blur(7px) brightness(0.8);
    }

    /* Voile pour garder le texte/les cards lisibles par-dessus, plus prononcé
       pendant qu'une installation tourne (met la progression en avant). */
    .scrim {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.15);
        transition: background var(--duration-slow) var(--ease-in-out);
    }

    .scrim.darkened {
        background: rgba(0, 0, 0, 0.58);
    }

    .scrim.dimmed {
        background: rgba(0, 0, 0, 0.72);
    }

    .depth {
        position: absolute;
        inset: 0;
        background: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0.15) 0%,
            rgba(0, 0, 0, 0.35) 45%,
            rgba(0, 0, 0, 0.6) 100%
        );
    }
</style>
