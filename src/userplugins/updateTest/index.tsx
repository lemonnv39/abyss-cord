/*
 * Abyss, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Plugin futile, uniquement destiné à tester la chaîne de mise à jour d'Abyss
 * via l'injecteur autonome (lemonnv39/abyss-injector). Il affiche un toast au
 * démarrage de Discord avec un « tag de build » : si l'injecteur distribue bien
 * la nouvelle build de la branche `builds`, relancer Discord affiche le tag
 * courant → on sait que la mise à jour a été appliquée.
 *
 * Pour un nouveau test : incrémente BUILD_TAG, push, puis mets à jour via
 * l'injecteur et vérifie que le toast affiche la nouvelle valeur.
 */

import definePlugin from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

const BUILD_TAG = "test-1 · 2026-10-01";

export default definePlugin({
    name: "AbyssUpdateTest",
    enabledByDefault: true,
    description: "Plugin de test : affiche un toast au démarrage pour vérifier que l'injecteur distribue bien les mises à jour d'Abyss.",
    authors: [{ name: "0ctane", id: 0n }],

    start() {
        // Petit délai : laisse l'UI de Discord (et le système de toasts) se
        // monter avant d'afficher quoi que ce soit.
        setTimeout(() => {
            try {
                showToast(`Abyss à jour ✓ — build ${BUILD_TAG}`, Toasts.Type.SUCCESS);
            } catch {
                // best-effort : un test ne doit jamais casser le démarrage.
            }
            console.log(`[AbyssUpdateTest] build ${BUILD_TAG} chargé`);
        }, 3000);
    },
});
