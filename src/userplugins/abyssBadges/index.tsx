/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * AbyssBadges — un badge de profil « Utilisateur Abyss », visible par TOUS les
 * clients Abyss, sur les comptes présents dans une liste curée.
 *
 * La liste (et l'image + le libellé du badge) vit dans un simple `badges.json`
 * hébergé à la racine du repo de livraison et récupéré au RUNTIME. Ajouter ou
 * retirer un ID = éditer ce JSON et pousser — aucun rebuild de la dist. On met
 * en cache la dernière liste (DataStore) pour l'afficher même avant/ sans le
 * fetch. `raw.githubusercontent.com` est déjà autorisé par la CSP (connect-src
 * + img-src) et l'image par défaut est un data-URI, donc aucune modif CSP.
 */

import { BadgePosition, ProfileBadge } from "@api/Badges";
import { DataStore } from "@api/index";
import definePlugin from "@utils/types";

// IMPORTANT : doit pointer sur un repo PUBLIC — raw.githubusercontent.com ne sert
// pas les repos privés (le repo de livraison `0ctane6/abyss` est privé → 404).
// `lemonnv39/abyss-cord` est public et reçoit chaque push, donc éditer badges.json
// là-bas + push = liste à jour au runtime, sans rebuild.
const BADGES_URL = "https://raw.githubusercontent.com/lemonnv39/abyss-cord/main/badges.json";
const CACHE_KEY = "abyssBadges-cache";
const REFRESH_MS = 1000 * 60 * 30; // 30 min

let abyssUsers = new Set<string>();
let refreshTimer: any;

// Une seule entrée de badge : `shouldShow` lit l'ensemble courant (mis à jour
// après chaque fetch), et `iconSrc`/`description` sont ré-lus au rendu — donc les
// muter après le fetch suffit à refléter le JSON distant sans re-registration.
const badge: ProfileBadge = {
    id: "abyss-user",
    description: "Utilisateur Abyss",
    iconSrc: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjOGI1Y2Y2Ii8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNDMyMmE4Ii8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiByeD0iNyIgZmlsbD0idXJsKCNnKSIvPjxwYXRoIGQ9Ik0xMiA1LjJsNS4yIDEzLjZoLTIuNTVsLTEuMDItMi44NmgtMy4yNkw5LjM1IDE4LjhINi44TDEyIDUuMnptMCA0LjVsLTEuMTIgMy4wNmgyLjI0TDEyIDkuN3oiIGZpbGw9IiNmZmYiLz48L3N2Zz4=",
    position: BadgePosition.START,
    link: "https://skinwalker.dev",
    shouldShow: ({ userId }) => abyssUsers.has(userId),
};

interface BadgeData {
    users?: string[];
    image?: string;
    tooltip?: string;
}

function apply(data: BadgeData | null | undefined) {
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data.users)) abyssUsers = new Set(data.users.map(String));
    if (typeof data.image === "string" && data.image) badge.iconSrc = data.image;
    if (typeof data.tooltip === "string" && data.tooltip) badge.description = data.tooltip;
}

async function loadBadges() {
    // 1) Cache immédiat : badges visibles tout de suite (et hors-ligne).
    try {
        const cached = await DataStore.get<BadgeData>(CACHE_KEY);
        if (cached) apply(cached);
    } catch { /* pas de storage */ }
    // 2) Rafraîchit depuis la liste curée.
    try {
        const res = await fetch(BADGES_URL, { cache: "no-cache" });
        if (!res.ok) return;
        const data = await res.json() as BadgeData;
        apply(data);
        try { await DataStore.set(CACHE_KEY, data); } catch { /* pas de storage */ }
    } catch (e) {
        console.error("[AbyssBadges] fetch de la liste échoué :", e);
    }
}

export default definePlugin({
    name: "AbyssBadges",
    description: "Affiche un badge « Utilisateur Abyss » sur le profil des membres de la communauté Abyss (liste curée, visible par tous les utilisateurs Abyss).",
    authors: [{ name: "0ctane", id: 0n }],
    // `required` : toujours actif et NON désactivable par l'utilisateur —
    // l'interrupteur est verrouillé et le moteur force le démarrage du plugin.
    required: true,
    userProfileBadges: [badge],

    async start() {
        await loadBadges();
        clearInterval(refreshTimer);
        refreshTimer = setInterval(loadBadges, REFRESH_MS);
    },
    stop() {
        clearInterval(refreshTimer);
    },
});
