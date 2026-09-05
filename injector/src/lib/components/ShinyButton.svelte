<!--
    ⚠️ PROVISOIRE : le contenu réel de ShinyButton.tsx/.css (déjà validé par
    l'utilisateur côté React) n'a pas été fourni — seul un placeholder est
    arrivé dans la demande. Ce composant reproduit le comportement DÉCRIT
    (3 états, design noir/blanc sobre, effet de balayage lumineux) avec des
    noms de classes propres à cette implémentation. Dès que le vrai
    ShinyButton.tsx/.css est fourni, remplacer ce fichier + ShinyButton.css
    pour matcher exactement (mêmes classes, mêmes keyframes).
-->
<script lang="ts">
    import "./ShinyButton.css";

    type ShinyButtonState = "idle" | "update" | "loading";

    let {
        state = "idle",
        version = "",
        onClick,
    }: {
        state?: ShinyButtonState;
        version?: string;
        onClick?: () => void;
    } = $props();

    // $derived plutôt qu'un objet const : `version` est un prop réactif, un
    // objet figé au premier rendu ne suivrait pas ses changements ultérieurs.
    let label = $derived.by(() => {
        switch (state) {
            case "update":
                return `Mettre à jour · v${version}`;
            case "loading":
                return "Mise à jour…";
            default:
                return "Vérifier les mises à jour";
        }
    });
</script>

<button
    class="shiny-btn"
    class:shiny-btn--update={state === "update"}
    class:shiny-btn--loading={state === "loading"}
    disabled={state === "loading"}
    onclick={() => onClick?.()}
>
    <span class="shiny-btn__sweep" aria-hidden="true"></span>

    {#if state === "update"}
        <span class="shiny-btn__dot" aria-hidden="true"></span>
    {/if}
    {#if state === "loading"}
        <span class="shiny-btn__spinner" aria-hidden="true"></span>
    {/if}

    <span class="shiny-btn__label">{label}</span>
</button>
