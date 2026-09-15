/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Cache les boutons natifs "Aide" et "Boîte de réception" de la barre du
 * haut — juste pour un client plus épuré, aucune fonctionnalité derrière.
 *
 * Discord construit cette barre comme une série de tests "TYPE"===x, chacun
 * suivi d'un bouton réel ou d'un objet vide {} si la condition est fausse
 * (voir HeaderBarAPI, qui s'accroche juste après le test "HELP"===... dans
 * ce même module — find: '?"BACK_FORWARD_NAVIGATION":'). Plutôt que de
 * réécrire tout le ternaire (dont on ne connaît pas le détail exact d'une
 * version à l'autre), on change juste la CHAÎNE comparée : le test ne peut
 * alors plus jamais être vrai, la branche vide est prise à sa place, le
 * reste de la barre (tout le reste du tableau) n'est jamais touché.
 *
 * Robuste aux traductions (Aide/Help, Boîte de réception/Inbox) puisqu'on ne
 * touche jamais à un texte affiché, juste à une constante interne.
 *
 * "HELP"=== apparaît PLUSIEURS FOIS dans ce module (pour d'autres usages
 * sans rapport) — un premier essai qui matchait juste la chaîne nue sans
 * contexte a neutralisé la mauvaise occurrence et n'a rien caché du tout.
 * Le lookahead ci-dessous exige exactement le même contexte que le regex de
 * HeaderBarAPI (`===...jusqu'à 75 caractères...{})`) pour être sûr de viser
 * l'occurrence RÉELLEMENT liée à l'affichage du bouton, pas une autre.
 *
 * Deux patches séparés (même `find`, `replacement` différent chacun) plutôt
 * qu'un tableau sur un seul patch : si le nom exact du type "Inbox" change
 * un jour côté Discord et que ce patch précis cesse de matcher, l'autre
 * (Help) continue de s'appliquer indépendamment au lieu de tomber avec lui.
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "HideHeaderButtons",
    description: "Cache les boutons natifs \"Aide\" et \"Boîte de réception\" de la barre du haut de Discord.",
    authors: [{ name: "0ctane", id: 0n }],
    enabledByDefault: false,

    patches: [
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /"HELP"(?====.{0,75}\{\}\))/,
                replace: '"__ABYSS_HELP_HIDDEN__"',
            },
        },
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /"INBOX"(?====.{0,75}\{\}\))/,
                replace: '"__ABYSS_INBOX_HIDDEN__"',
            },
        },
    ],
});
