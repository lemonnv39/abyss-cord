/*
 * Abyss, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Plugin de démonstration, sans effet. Sa seule raison d'être est de servir de
 * « nouveau plugin » détectable par AbyssUpdates, afin de valider que la pop-up
 * « Quoi de neuf » liste bien les ajouts après une mise à jour.
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "AbyssHelloWorld",
    enabledByDefault: false,
    description: "Plugin de démonstration — sert à valider la pop-up de nouveautés d'Abyss.",
    authors: [{ name: "0ctane", id: 0n }],
});
