/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Fake Mute / Fake Deafen - sends a Gateway packet (op 4, Voice State Update)
 * directly, with self_mute/self_deaf values that differ from the real local
 * audio state. You show up muted/deafened to everyone else in the channel,
 * but your mic and audio output keep working locally - Discord doesn't cut
 * anything, only what other people see changes.
 *
 * Ported from mushzi's original implementation (credited below) - same
 * logic, just adapted to this repo's conventions.
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, ContextMenuApi, FluxDispatcher, Menu, MediaEngineStore, React, SelectedChannelStore, UserStore } from "@webpack/common";

let ghostActive = false;
let wantMute = true;
let wantDeafen = true;
let lastSyncTime = 0;

const GatewaySocket = findByPropsLazy("getSocket");

function sendFakeVoiceState() {
    try {
        const channelId = SelectedChannelStore?.getVoiceChannelId?.();
        if (!channelId) return;

        const socket = GatewaySocket?.getSocket?.();
        if (!socket) return;

        const channel = ChannelStore?.getChannel?.(channelId);

        const selfMute = ghostActive ? wantMute : MediaEngineStore.isSelfMute();
        const selfDeaf = ghostActive ? wantDeafen : MediaEngineStore.isSelfDeaf();

        socket.send(4, {
            guild_id: channel?.guild_id ?? null,
            channel_id: channelId,
            self_mute: selfMute,
            self_deaf: selfDeaf,
            self_video: false,
        });
    } catch (e) {
        console.error("[FakeVoice] sendFakeVoiceState error:", e);
    }
}

function syncState() {
    if (!SelectedChannelStore?.getVoiceChannelId?.()) return;
    lastSyncTime = Date.now();
    sendFakeVoiceState();
}

function onVoiceStateChange(event: any) {
    if (!ghostActive) return;
    if (Date.now() - lastSyncTime < 1000) return;

    if (event?.type === "VOICE_STATE_UPDATES") {
        const myId = UserStore.getCurrentUser()?.id;
        const myUpdate = event.voiceStates?.find((v: any) => v.userId === myId);
        if (!myUpdate) return;
    }

    lastSyncTime = Date.now();
    setTimeout(sendFakeVoiceState, 0);
}

function FakeVoiceIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C7.58 2 4 5.58 4 10V19C4 20.66 5.34 22 7 22C8.66 22 10 20.66 10 19C10 20.66 11.34 22 13 22C14.66 22 16 20.66 16 19C16 20.66 17.34 22 19 22C20.66 22 22 20.66 22 19V10C22 5.58 18.42 2 14 2H10H12Z" fill="currentColor" />
            <circle cx="8.5" cy="10" r="1.5" fill="black" fillOpacity="0.6" />
            <circle cx="15.5" cy="10" r="1.5" fill="black" fillOpacity="0.6" />
            {ghostActive && <path d="M2 2L22 22" stroke="#ed4245" strokeWidth="2.5" strokeLinecap="round" />}
        </svg>
    );
}

function GhostContextMenu() {
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
    return (
        <Menu.Menu navId="abyss-fake-voice-menu" aria-label="Fake Voice" onClose={ContextMenuApi.closeContextMenu}>
            <Menu.MenuGroup label="Options">
                <Menu.MenuCheckboxItem
                    id="opt-both"
                    label="Fake Mute + Deafen"
                    checked={wantMute && wantDeafen}
                    action={() => {
                        const next = !(wantMute && wantDeafen);
                        wantMute = next;
                        wantDeafen = next;
                        forceUpdate();
                        if (ghostActive) sendFakeVoiceState();
                    }}
                />
                <Menu.MenuSeparator />
                <Menu.MenuCheckboxItem
                    id="opt-mute"
                    label="Fake Mute"
                    checked={wantMute}
                    action={() => {
                        wantMute = !wantMute;
                        forceUpdate();
                        if (ghostActive) sendFakeVoiceState();
                    }}
                />
                <Menu.MenuCheckboxItem
                    id="opt-deafen"
                    label="Fake Deafen"
                    checked={wantDeafen}
                    action={() => {
                        wantDeafen = !wantDeafen;
                        forceUpdate();
                        if (ghostActive) sendFakeVoiceState();
                    }}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function FakeVoiceButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
    return (
        <UserAreaButton
            onClick={() => {
                ghostActive = !ghostActive;
                syncState();
                forceUpdate();
            }}
            onContextMenu={(e: React.MouseEvent) => ContextMenuApi.openContextMenu(e, () => <GhostContextMenu />)}
            tooltipText={hideTooltips ? undefined : ghostActive ? "Disable Fake Voice" : "Enable Fake Voice (right-click: options)"}
            icon={<FakeVoiceIcon className={iconForeground} />}
            role="switch"
            aria-checked={ghostActive}
            redGlow={false}
            plated={nameplate != null}
        />
    );
}

const FakeVoiceUserAreaButton: UserAreaButtonFactory = props => <FakeVoiceButton {...props} />;

export default definePlugin({
    name: "FakeVoice",
    description: "Shows up muted/deafened to other members of the voice channel, while your mic and audio keep working normally on your end.",
    authors: [{ name: "mushzi", id: 449282863582412850n }],
    dependencies: ["CommandsAPI", "UserAreaAPI"],
    enabledByDefault: false,

    start() {
        FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_MUTE", onVoiceStateChange);
        FluxDispatcher.subscribe("AUDIO_TOGGLE_SELF_DEAF", onVoiceStateChange);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", onVoiceStateChange);
    },

    stop() {
        FluxDispatcher.unsubscribe("AUDIO_TOGGLE_SELF_MUTE", onVoiceStateChange);
        FluxDispatcher.unsubscribe("AUDIO_TOGGLE_SELF_DEAF", onVoiceStateChange);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", onVoiceStateChange);
        ghostActive = false;
    },

    userAreaButton: {
        icon: FakeVoiceIcon,
        render: FakeVoiceUserAreaButton
    },

    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fakemute",
            description: "Toggle Fake Mute",
            execute: async (_, ctx) => {
                wantMute = !wantMute;
                ghostActive = wantMute || wantDeafen;
                syncState();
                sendBotMessage(ctx.channel.id, { content: `Fake Mute ${wantMute ? "enabled" : "disabled"}.` });
            },
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fakedeafen",
            description: "Toggle Fake Deafen",
            execute: async (_, ctx) => {
                wantDeafen = !wantDeafen;
                ghostActive = wantMute || wantDeafen;
                syncState();
                sendBotMessage(ctx.channel.id, { content: `Fake Deafen ${wantDeafen ? "enabled" : "disabled"}.` });
            },
        },
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fakedeafen_mute",
            description: "Toggle Fake Deafen & Mute simultaneously",
            execute: async (_, ctx) => {
                const next = !(wantMute && wantDeafen);
                wantMute = next;
                wantDeafen = next;
                ghostActive = next;
                syncState();
                sendBotMessage(ctx.channel.id, { content: `Fake Deafen & Mute ${ghostActive ? "enabled" : "disabled"}.` });
            },
        },
    ]
});
