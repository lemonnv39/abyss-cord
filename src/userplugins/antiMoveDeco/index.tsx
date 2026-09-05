/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, React, Toasts, UserStore } from "@webpack/common";

const ChannelActions = findByPropsLazy("selectVoiceChannel", "disconnect");
const SelectedChannelStore = findByPropsLazy("getVoiceChannelId", "getChannelId");

let enabled = false;
let targetChannelId: string | null = null;

function onVoiceStateUpdate({ voiceStates }: { voiceStates: any[]; }) {
    if (!enabled || !targetChannelId) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;
    const myId = currentUser.id;

    const myState = voiceStates.find(s => s.userId === myId);
    if (myState && myState.channelId !== targetChannelId) {
        setTimeout(() => {
            if (enabled && targetChannelId) {
                try { ChannelActions?.selectVoiceChannel?.(targetChannelId); } catch { }
            }
        }, 500);
    }
}

function AntiMoveDecoIcon({ enabled, width = 20, height = 20 }: { enabled: boolean; width?: number; height?: number; }) {
    const color = enabled ? "#39FF14" : "currentColor";
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke={color} strokeWidth="2.5" />
        </svg>
    );
}

function AntiMoveDecoButton() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const toggle = () => {
        if (!enabled) {
            const channelId = SelectedChannelStore?.getVoiceChannelId?.();
            if (!channelId) {
                Toasts.show(Toasts.create("Join a voice channel first", Toasts.Type.FAILURE));
                return;
            }
            targetChannelId = channelId;
            enabled = true;
        } else {
            enabled = false;
            targetChannelId = null;
        }
        forceUpdate();
    };

    return (
        <HeaderBarButton
            icon={props => <AntiMoveDecoIcon enabled={enabled} {...props} />}
            tooltip={enabled ? "AntiMove & Deco: ON — click to disable" : "AntiMove & Deco: OFF — click to enable"}
            selected={enabled}
            onClick={toggle}
        />
    );
}

export default definePlugin({
    name: "AntiMoveDeco",
    enabledByDefault: false,
    description: "Adds a button that snaps you back into your current voice channel if you get moved or disconnected from it.",
    authors: [{ name: "0ctane", id: 0n }],

    headerBarButton: {
        icon: () => <AntiMoveDecoIcon enabled={enabled} />,
        render: AntiMoveDecoButton,
        priority: 3
    },

    start() {
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", onVoiceStateUpdate);
    },
    stop() {
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", onVoiceStateUpdate);
        enabled = false;
        targetChannelId = null;
    }
});
