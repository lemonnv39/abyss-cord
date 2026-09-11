/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * WordBombHelper — porté directement du "WordBomb" de Nightcord (leur
 * version standalone-window construite dans src/main/ipcMain.ts, pas leur
 * WordBombOverlay.tsx in-page). Ce fichier n'est que le bouton d'ouverture —
 * toute l'UI vit dans panel.html, toute la logique de frappe/fenêtre dans
 * native.ts (voir son en-tête pour le détail du portage et ce qui a été
 * volontairement exclu : StreamProof, définitions IA).
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { BookmarkIcon } from "@components/Icons";
import definePlugin, { PluginNative } from "@utils/types";
import { Toasts, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.WordBombHelper as PluginNative<typeof import("./native")>;

function BookIcon() {
    return <BookmarkIcon width={20} height={20} />;
}

function WordBombHelperButton() {
    const [open, setOpen] = useState(false);

    async function toggle() {
        try {
            const res = await Native.openWindow();
            setOpen(res.status === "opened");
        } catch (e) {
            Toasts.show(Toasts.create("Failed to open WordBomb Helper", Toasts.Type.FAILURE));
            console.error("[WordBombHelper]", e);
        }
    }

    return (
        <HeaderBarButton
            icon={BookIcon}
            tooltip={open ? "Close WordBomb Helper" : "Open WordBomb Helper"}
            selected={open}
            onClick={toggle}
        />
    );
}

export default definePlugin({
    name: "WordBombHelper",
    enabledByDefault: false,
    description: "WordBomb assistant in its own draggable window: a live A-Z grid tracks which letters you still need, understands prefix/suffix syllables (\"th-\", \"-er\") as well as plain substrings, auto-picks the best word (theme-aware, with your own custom words mixed in) and types it for real at a speed and human-like typo rate you control. Keeps a short history of what it typed, and a global Ctrl+Alt+F hotkey brings the window back and refocuses the input without touching the mouse. Settings persist between sessions.",
    authors: [{ name: "0ctane", id: 0n }],

    headerBarButton: {
        icon: BookIcon,
        render: WordBombHelperButton,
        priority: 2,
    },
});
