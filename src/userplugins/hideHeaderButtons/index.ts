/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Cache les boutons natifs "Aide" et "Boîte de réception" de la barre du
 * haut — juste pour un client plus épuré, aucune fonctionnalité derrière.
 *
 * v1 et v2 de ce plugin ciblaient une chaîne "HELP"/"INBOX" utilisée pour
 * calculer `h`, une valeur passée en `focusSectionProps` — un détail
 * d'ACCESSIBILITÉ CLAVIER (quelle section du header reçoit le focus en
 * premier), sans aucun rapport avec l'affichage réel des boutons. Neutraliser
 * cette chaîne ne cachait donc rien, quelle que soit la précision du
 * contexte du regex : la mauvaise variable était visée depuis le début.
 *
 * Vérifié directement dans le vrai bundle Discord (web, même code que le
 * client desktop pour ce composant) — le rendu réel ressemble à :
 *   leading:  [A && jsx(BackForward, {focusSectionProps: "BACK_FORWARD_NAVIGATION"===h?e:void 0}),
 *              s && jsx(InboxButton, {focusSectionProps: "NOTIFICATIONS_INBOX"===h?e:void 0}), ...]
 *   trailing: [..., n ? jsx(HelpA,{focusSectionProps:"HELP"===h?e:void 0})
 *                    : jsx(HelpB,{focusSectionProps:"HELP"===h?e:void 0}), ...]
 * Le bouton Inbox est gardé par un simple `s &&` (facile à neutraliser en
 * `false`). Le bouton Aide, lui, est un ternaire qui rend TOUJOURS l'un des
 * deux composants (`n ? A : B`) — impossible de le cacher via un booléen,
 * il faut remplacer le ternaire entier par `null`.
 *
 * Les noms de variables minifiés (s, n, h, e, A, les composants) changent à
 * chaque build Discord — les regex ci-dessous ne s'appuient donc QUE sur les
 * chaînes stables ("NOTIFICATIONS_INBOX", "HELP", "focusSectionProps",
 * "void 0") avec des \w+ pour tout le reste, exactement comme le fait
 * HeaderBarAPI (find: '?"BACK_FORWARD_NAVIGATION":') pour repérer ce module.
 *
 * Deux patches séparés (même `find`, `replacement` différent chacun) plutôt
 * qu'un tableau sur un seul patch : si l'un des deux cesse un jour de
 * matcher (renommage côté Discord), l'autre continue de s'appliquer
 * indépendamment au lieu de tomber avec lui.
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "HideHeaderButtons",
    description: "Cache les boutons natifs \"Aide\" et \"Boîte de réception\" de la barre du haut de Discord.",
    authors: [{ name: "0ctane", id: 0n }],
    enabledByDefault: false,

    patches: [
        {
            // Bouton "Boîte de réception" : simple garde `s && jsx(...)` -> false.
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /\w+&&\(0,\w+\.jsx\)\(\w+,\{focusSectionProps:"NOTIFICATIONS_INBOX"===\w+\?\w+:void 0\}\)/,
                replace: "false",
            },
        },
        {
            // Bouton "Aide" : ternaire qui rend toujours quelque chose -> null.
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /\w+\?\(0,\w+\.jsx\)\(\w+,\{focusSectionProps:"HELP"===\w+\?\w+:void 0\}\):\(0,\w+\.jsx\)\(\w+,\{focusSectionProps:"HELP"===\w+\?\w+:void 0\}\)/,
                replace: "null",
            },
        },
    ],
});
