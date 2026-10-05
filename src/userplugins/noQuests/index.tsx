/*
 * Abyss, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * NoQuests — supprime toute la section « Quêtes » de Discord pour ne jamais
 * accepter une quête par accident (et récupérer un badge non désiré).
 *
 * Approche robuste côté DONNÉES plutôt que de chasser des classes CSS qui
 * changent souvent : on neutralise le `QuestsStore` (nom de store stable) pour
 * que `quests` renvoie toujours une collection vide. Du coup la barre de quêtes
 * au-dessus des MP, les pop-ups/upsell, l'onglet rempli et les invites à
 * s'inscrire n'ont plus rien à afficher — donc plus de bouton « Accepter » à
 * cliquer par mégarde. Le getter avale aussi les réassignations (setter no-op),
 * si bien qu'un fetch de quêtes ultérieur ne le « re-remplit » pas.
 *
 * Le CSS (noQuests.css) ne fait qu'un nettoyage visuel d'appoint : l'entrée
 * d'onglet « Quêtes » et quelques encarts statiques. NB : ça n'enlève pas un
 * badge de quête DÉJÀ obtenu sur un compte (c'est côté serveur Discord) — ça
 * empêche seulement les futurs accidents et masque la section localement.
 */

import { disableStyle, enableStyle } from "@api/Styles";
import definePlugin from "@utils/types";
import { findStore } from "@webpack";

import style from "./noQuests.css?managed";

interface Patched {
    store: any;
    /** Descripteur d'origine si `quests` était une propriété PROPRE du store. */
    ownDesc: PropertyDescriptor | undefined;
}

let patched: Patched | null = null;

function neutralizeStore() {
    let store: any;
    try {
        store = findStore("QuestsStore");
    } catch {
        store = null;
    }
    if (!store) return;

    const proto = Object.getPrototypeOf(store);
    const hasQuests =
        Object.getOwnPropertyDescriptor(store, "quests") ||
        (proto && Object.getOwnPropertyDescriptor(proto, "quests"));
    if (!hasQuests) return;

    patched = {
        store,
        ownDesc: Object.getOwnPropertyDescriptor(store, "quests"),
    };

    // get -> toujours vide ; set -> no-op (évite de casser le store si son
    // handler réassigne `this.quests`, et empêche tout re-remplissage).
    Object.defineProperty(store, "quests", {
        configurable: true,
        get: () => new Map(),
        set: () => {},
    });

    try {
        store.emitChange?.();
    } catch {
        /* best-effort */
    }
}

function restoreStore() {
    if (!patched) return;
    const { store, ownDesc } = patched;
    try {
        if (ownDesc) {
            // `quests` était propre au store : on remet le descripteur d'origine.
            Object.defineProperty(store, "quests", ownDesc);
        } else {
            // Il venait du prototype : retirer notre override ré-expose l'original.
            delete store.quests;
        }
        store.emitChange?.();
    } catch {
        /* best-effort */
    }
    patched = null;
}

export default definePlugin({
    name: "NoQuests",
    description:
        "Supprime toute la section Quêtes de Discord (onglet, bannières, pop-ups) pour ne jamais accepter une quête — ni récupérer un badge — par accident.",
    authors: [{ name: "0ctane", id: 0n }],
    enabledByDefault: true,

    start() {
        enableStyle(style);
        neutralizeStore();
    },

    stop() {
        disableStyle(style);
        restoreStore();
    },
});
