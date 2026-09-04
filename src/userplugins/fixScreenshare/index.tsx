/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const MediaEngineStore = findByPropsLazy("getMediaEngine");

function fixEngine() {
    try {
        const engine = MediaEngineStore.getMediaEngine();
        if (engine && typeof engine.reconfigure === "function") {
            engine.reconfigure();
        }
    } catch { }
}

const handleVoiceChannelSelect = () => {
    setTimeout(fixEngine, 1000);
};

export default definePlugin({
    name: "FixScreenshare",
    enabledByDefault: false,
    description: "Fixes infinite loading and crashes on screenshare after a client reload by forcing the media engine to re-initialize.",
    authors: [{ name: "0ctane", id: 0n }],

    start() {
        fixEngine();
        setTimeout(fixEngine, 5000);
        setTimeout(fixEngine, 15000);
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
    }
});
