/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * WordBombHelper — ported from Nightcord's wordBomb plugin, their later
 * standalone-window version (see native.ts's header for the full
 * rundown): a real separate, frameless, always-on-top BrowserWindow
 * (panel.html) rather than a React overlay inside Discord's own window.
 * This file is now just the toggle button — all the actual UI lives in
 * panel.html, and the typing/window-management logic lives in native.ts.
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
    description: "WordBomb assistant in its own draggable window: tracks which letters you haven't used, auto-picks the best word for the letters you're given, and types it for real at a speed and human-like typo rate you control (settings persist between sessions). Click into WordBomb's own text field first — the sequence also clicks the window's center itself to help focus land right, but it doesn't reach into the game itself.",
    authors: [{ name: "0ctane", id: 0n }],

    headerBarButton: {
        icon: BookIcon,
        render: WordBombHelperButton,
        priority: 2,
    },
});
