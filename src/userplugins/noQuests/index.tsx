/*
 * Abyss, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * NoQuests — bloque toute la section « Quêtes » de Discord pour ne jamais
 * accepter une quête (et récupérer un badge) par accident.
 *
 * Plutôt que de réimplémenter la suppression des quêtes (fragile, Discord
 * bouge souvent ces modules), on s'appuie sur le plugin Equicord **Questify**
 * qui le fait déjà proprement via son réglage « Disable all Quest features »
 * (disableQuestsEverything). Ce plugin se contente donc, UNE SEULE FOIS,
 * d'activer Questify et de cocher ce réglage. On ne le refait pas à chaque
 * démarrage : si l'utilisateur rallume les quêtes plus tard, son choix est
 * respecté.
 *
 * Les patches de Questify s'appliquent au CHARGEMENT du bundle : la toute
 * première fois (si Questify était éteint), il faut redémarrer Discord une fois
 * pour que le blocage prenne effet — d'où le toast d'info. Ensuite c'est
 * permanent et transparent.
 *
 * NB : ça n'enlève pas un badge de quête DÉJÀ obtenu (côté serveur Discord) ;
 * ça empêche seulement les futurs accidents.
 */

import { get, set } from "@api/DataStore";
import { Settings } from "@api/Settings";
import definePlugin from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

const APPLIED_KEY = "NoQuests_appliedQuestify";

export default definePlugin({
    name: "NoQuests",
    description:
        "Bloque toute la section Quêtes de Discord (via Questify) pour ne jamais accepter une quête — ni récupérer un badge — par accident. S'active une seule fois ; ton choix est ensuite respecté.",
    authors: [{ name: "0ctane", id: 0n }],
    enabledByDefault: true,

    async start() {
        // On n'applique la config qu'une seule fois, pour ne pas écraser un
        // choix ultérieur de l'utilisateur (qui voudrait réactiver les quêtes).
        let applied = false;
        try {
            applied = !!(await get(APPLIED_KEY));
        } catch {
            applied = false;
        }
        if (applied) return;

        let wasEnabled = false;
        try {
            // Accéder à Settings.plugins.Questify matérialise l'objet de réglages.
            const q = Settings.plugins.Questify as any;
            wasEnabled = q?.enabled === true;
            q.enabled = true;
            q.disableQuestsEverything = true;
        } catch (e) {
            console.error("[NoQuests] impossible d'appliquer les réglages Questify :", e);
            return;
        }

        try {
            await set(APPLIED_KEY, true);
        } catch {
            /* best-effort */
        }

        // Si Questify était éteint, ses patches ne s'appliquent qu'au prochain
        // chargement → on invite à redémarrer une fois.
        if (!wasEnabled) {
            setTimeout(() => {
                try {
                    showToast(
                        "Abyss : section Quêtes bloquée — redémarre Discord une fois pour finaliser.",
                        Toasts.Type.SUCCESS
                    );
                } catch {
                    /* ignore */
                }
            }, 4000);
        }
    },
});
