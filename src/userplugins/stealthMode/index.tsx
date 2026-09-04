/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isHeaderBarButtonsHidden, setHeaderBarButtonsHidden } from "@api/HeaderBar";
import definePlugin from "@utils/types";

// Same underlying "hide all plugin header buttons" mechanism as CompactMode,
// but toggled only via Ctrl+Shift+H — no visible button of its own, so
// plugin buttons vanish completely rather than being replaced by an icon.

function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setHeaderBarButtonsHidden(!isHeaderBarButtonsHidden());
    }
}

export default definePlugin({
    name: "StealthMode",
    enabledByDefault: false,
    description: "Hides every plugin's header bar button without disabling them. Toggle with Ctrl+Shift+H.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["HeaderBarAPI"],

    start() {
        document.addEventListener("keydown", handleKeydown);
    },

    stop() {
        document.removeEventListener("keydown", handleKeydown);
        setHeaderBarButtonsHidden(false);
    },
});
