/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Cache les boutons natifs "Aide" et "Boîte de réception" de la barre du
 * haut — juste pour un client plus épuré, aucune fonctionnalité derrière.
 *
 * v1 et v2 ciblaient une chaîne "HELP"/"INBOX" utilisée pour calculer `h`,
 * une valeur passée en `focusSectionProps` (accessibilité clavier, sans
 * rapport avec l'affichage). v3 a corrigé ça pour "Aide" (confirmé en jeu :
 * un ternaire qui rend toujours l'un de deux composants, remplacé par
 * `null`), et a aussi neutralisé le garde `s&&jsx(...)` du bouton Inbox
 * classique ("NOTIFICATIONS_INBOX"). Résultat en jeu : Aide disparaît bel et
 * bien, mais Boîte de réception reste affichée quand même — donc soit ce
 * compte a une variante plus récente de ce composant (rollout Discord type
 * "Orbs"/expérimentations vues dans le même bundle) gérée par un chemin de
 * code différent, soit le patch touche la bonne variable mais Discord monte
 * un DEUXIÈME bouton équivalent ailleurs. Confirmé aussi : `toString()` sur
 * une factory webpack patchée renvoie TOUJOURS le code d'origine en
 * production (Vencord le fait exprès), donc impossible de vérifier via la
 * console si un patch a param pris ou non sur ce compte — vérification
 * uniquement possible visuellement.
 *
 * Plutôt que de continuer à deviner la structure JS exacte, "Boîte de
 * réception" est cachée par CSS sur son aria-label (voir hideBugReport.css
 * dans experiments/ pour un précédent dans ce repo) — fiable quelle que soit
 * la variante de composant utilisée, seul inconvénient : dépend du texte
 * affiché, donc du français ici (client toujours en FR).
 */

import { disableStyle, enableStyle } from "@api/Styles";
import definePlugin from "@utils/types";

import hideInboxStyle from "./hideInbox.css?managed";

export default definePlugin({
    name: "HideHeaderButtons",
    description: "Cache les boutons natifs \"Aide\" et \"Boîte de réception\" de la barre du haut de Discord.",
    authors: [{ name: "0ctane", id: 0n }],
    enabledByDefault: false,

    patches: [
        {
            // Bouton "Aide" : ternaire qui rend toujours quelque chose -> null.
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /\w+\?\(0,\w+\.jsx\)\(\w+,\{focusSectionProps:"HELP"===\w+\?\w+:void 0\}\):\(0,\w+\.jsx\)\(\w+,\{focusSectionProps:"HELP"===\w+\?\w+:void 0\}\)/,
                replace: "null",
            },
        },
    ],

    start: () => enableStyle(hideInboxStyle),
    stop: () => disableStyle(hideInboxStyle),
});
