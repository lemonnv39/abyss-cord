<script lang="ts">
    import { onMount } from "svelte";
    import { blur } from "svelte/transition";

    interface Item {
        text: string;
        /** Override la durée d'affichage par défaut pour CETTE phrase (ms). */
        duration?: number;
    }

    let { items, defaultDuration = 2800 }: { items: Item[]; defaultDuration?: number } = $props();

    let index = $state(0);
    let reduced = $state(false);

    onMount(() => {
        reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        if (reduced || items.length <= 1) return;

        let cancelled = false;
        let timeoutId: ReturnType<typeof setTimeout>;

        function schedule() {
            const ms = items[index].duration ?? defaultDuration;
            timeoutId = setTimeout(() => {
                if (cancelled) return;
                index = (index + 1) % items.length;
                schedule();
            }, ms);
        }
        schedule();

        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
    });
</script>

<!--
    Port Svelte de l'idée "MorphingText" (magicui, React) — même effet visuel
    (flou qui se dissout pendant que le texte change) obtenu avec la
    transition `blur` native de Svelte plutôt qu'une dépendance React qui ne
    peut de toute façon pas tourner ici. Chaque phrase peut avoir sa propre
    durée d'affichage (ex: le crédit reste plus longtemps que les taglines).
    Position absolute sur les deux variantes le temps du fondu croisé pour ne
    jamais faire sauter la mise en page.
-->
<div class="morph">
    {#key index}
        <span
            class="morph-text"
            in:blur={{ duration: reduced ? 0 : 480, amount: 8 }}
            out:blur={{ duration: reduced ? 0 : 320, amount: 8 }}
        >
            {items[index].text}
        </span>
    {/key}
</div>

<style>
    .morph {
        position: relative;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
    }

    .morph-text {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12.5px;
        font-weight: 500;
        color: var(--text-faint);
        white-space: nowrap;
        text-align: center;
    }
</style>
