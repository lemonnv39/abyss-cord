/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { MediaEngineStore, Menu, React, Toasts, useEffect, useState } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ChannelStore = findStoreLazy("ChannelStore");
const UserStore = findStoreLazy("UserStore");
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const FluxDispatcher = findByPropsLazy("dispatch", "subscribe");
const GatewaySocket = findByPropsLazy("getSocket");

const DS_KEY = "followuser-v2";

const settings = definePluginSettings({
    inactivityMinutes: {
        type: OptionType.SELECT,
        description: "Arrête automatiquement le suivi après cette durée sans activité vocale du compte suivi",
        options: [
            { label: "5 minutes", value: 5 },
            { label: "15 minutes", value: 15 },
            { label: "30 minutes", value: 30, default: true },
            { label: "1 heure", value: 60 },
            { label: "3 heures", value: 180 },
            { label: "Illimité (jamais)", value: 0 },
        ],
    },
});

// ── Etat global ───────────────────────────────────────────────────────────────
let followedId: string | null = null;
let followedName: string = "";
let followedChannel: string | null = null;
let fluxUnsub: (() => void) | null = null;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

// Fake mute/deafen — the icon other members see stays whatever it already
// was (self_mute/self_deaf are never touched here); only the REAL audio
// behaviour is cut independently, via the native MediaEngineConnection's own
// setSelfMute/setSelfDeaf (see getActiveConnection below) — NOT the gateway
// voice-state flag, and NOT navigator.mediaDevices.getUserMedia: Discord
// Desktop's voice pipeline goes through a native addon (discord_voice.node),
// not the browser's real getUserMedia/WebRTC path, so a getUserMedia hook
// (the previous approach here) never fires and silently does nothing.
let fakeMute = false;
let fakeDeafen = false;

const listeners = new Set<() => void>();
function notifyAll() { listeners.forEach(fn => fn()); }

function useFollowId(): string | null {
    const [, tick] = useState(0);
    useEffect(() => {
        const fn = () => tick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return followedId;
}

async function persist() {
    await DataStore.set(DS_KEY, followedId ? { id: followedId, name: followedName } : null);
}

function getChannelOf(userId: string): string | null {
    try {
        const all: any = VoiceStateStore?.getAllVoiceStates?.() ?? {};
        for (const guildMap of Object.values(all) as any[]) {
            if (guildMap?.[userId]?.channelId) return guildMap[userId].channelId;
        }
        return VoiceStateStore?.getVoiceStateForUser?.(userId)?.channelId ?? null;
    } catch { return null; }
}

function joinChannel(channelId: string) {
    try {
        const ch = ChannelStore?.getChannel?.(channelId);
        // Utilisation de setTimeout pour eviter de dispatch pendant un cycle de dispatch de Discord
        // ce qui cause le "dispatch during dispatch" error et fait crash/refresh le client
        setTimeout(() => {
            FluxDispatcher?.dispatch?.({
                type: "VOICE_CHANNEL_SELECT",
                channelId,
                guildId: ch?.guild_id ?? null,
            });
        }, 100);
    } catch { }
}

// ── Timer d'inactivite : unfollow auto configurable, ou jamais ────────────────
function resetInactivityTimer() {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    const minutes = settings.store.inactivityMinutes ?? 30;
    if (!minutes) return; // 0 = illimité, pas de timer du tout
    inactivityTimer = setTimeout(() => {
        if (followedId) {
            Toasts.show({ message: `Follow inactif ${minutes}min — arret du suivi de ${followedName}`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
            unfollow();
        }
    }, minutes * 60 * 1000);
}

function clearInactivityTimer() {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
}

// ── Fake mute / fake deafen ────────────────────────────────────────────────────
// Porté de Nightcord (FakeVoice) : on ne touche à rien côté audio réel — on
// ment sur le voice-state envoyé au Gateway (op 4). Les autres te voient
// muet et/ou sourd selon ce qu'on force ici, alors que ton micro et ton
// audio continuent de fonctionner normalement chez toi. Chaque champ est
// forcé indépendamment ; celui qui n'est pas "fake" reflète le vrai état
// (pas de mensonge accidentel sur l'autre moitié).
let lastFakeVoiceSync = 0;

function sendFakeVoiceState() {
    try {
        const channelId = SelectedChannelStore?.getVoiceChannelId?.();
        if (!channelId) return;
        const socket = GatewaySocket?.getSocket?.();
        if (!socket) return;
        const channel = ChannelStore?.getChannel?.(channelId);

        lastFakeVoiceSync = Date.now();
        socket.send(4, {
            guild_id: channel?.guild_id ?? null,
            channel_id: channelId,
            self_mute: fakeMute ? true : (MediaEngineStore?.isSelfMute?.() ?? false),
            self_deaf: fakeDeafen ? true : (MediaEngineStore?.isSelfDeaf?.() ?? false),
            self_video: false,
        });
    } catch (e) {
        console.error("[FollowUser] sendFakeVoiceState failed:", e);
    }
}

// Discord retente périodiquement de resynchroniser le voice-state avec
// l'état réel (qui, lui, n'a jamais bougé) — on réaffirme le mensonge à
// chaque écho, avec un debounce pour éviter une boucle serrée avec notre
// propre envoi.
function onFakeVoiceEcho() {
    if (!fakeMute && !fakeDeafen) return;
    if (Date.now() - lastFakeVoiceSync < 1000) return;
    setTimeout(sendFakeVoiceState, 0);
}

function toggleFakeMute() {
    fakeMute = !fakeMute;
    sendFakeVoiceState();
    notifyAll();
    Toasts.show({ message: fakeMute ? "Fake mute activé — les autres te voient muet, tu parles normalement" : "Fake mute désactivé", type: Toasts.Type.MESSAGE, id: Toasts.genId() });
}

function toggleFakeDeafen() {
    fakeDeafen = !fakeDeafen;
    sendFakeVoiceState();
    notifyAll();
    Toasts.show({ message: fakeDeafen ? "Fake deafen activé — les autres te voient sourd, tu entends normalement" : "Fake deafen désactivé", type: Toasts.Type.MESSAGE, id: Toasts.genId() });
}

// Rejoue le mensonge sur tout changement de voice state, pour contrer les
// tentatives de resync de Discord (voir onFakeVoiceEcho) et pour survivre à
// un changement de salon.
function onOwnVoiceStateEvent() {
    onFakeVoiceEcho();
}

// ── Listener voix ─────────────────────────────────────────────────────────────
function onVoiceStateUpdates(data: any) {
    if (!followedId) return;
    const states: any[] = Array.isArray(data?.voiceStates) ? data.voiceStates
        : data?.voiceStates != null ? Array.from(data.voiceStates as any) : [];
    for (const s of states) {
        if (s.userId !== followedId) continue;
        const newCh: string | null = s.channelId ?? null;
        if (newCh !== followedChannel) {
            followedChannel = newCh;
            if (newCh) {
                resetInactivityTimer(); // activite detectee, on repart pour la duree configuree
                joinChannel(newCh);
                Toasts.show({ message: `Suivi ${followedName} → vocal`, type: Toasts.Type.MESSAGE, id: Toasts.genId() });
            }
        }
    }
}

function startFlux() {
    if (fluxUnsub) return;
    FluxDispatcher?.subscribe?.("VOICE_STATE_UPDATES", onVoiceStateUpdates);
    fluxUnsub = () => FluxDispatcher?.unsubscribe?.("VOICE_STATE_UPDATES", onVoiceStateUpdates);
}
function stopFlux() { fluxUnsub?.(); fluxUnsub = null; }

// ── Follow / Unfollow ─────────────────────────────────────────────────────────
async function follow(userId: string) {
    const user = UserStore?.getUser?.(userId);
    const name = user?.globalName ?? user?.username ?? userId;

    // Si on followait deja quelqu'un d'autre, unfollow silencieux
    if (followedId && followedId !== userId) {
        stopFlux();
        clearInactivityTimer();
    }

    followedId = userId;
    followedName = name;
    followedChannel = getChannelOf(userId);

    await persist();
    startFlux();
    resetInactivityTimer();
    notifyAll();

    // Rejoindre immediatement son vocal si il est deja dans un channel
    if (followedChannel) {
        joinChannel(followedChannel);
        Toasts.show({ message: `Suivi ${name} ✓ — rejoint son vocal`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    } else {
        Toasts.show({ message: `Suivi ${name} ✓ — en attente d'un vocal`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    }
}

async function unfollow() {
    const name = followedName;
    followedId = null; followedName = ""; followedChannel = null;
    stopFlux();
    clearInactivityTimer();
    await persist();
    notifyAll();
    if (name) Toasts.show({ message: `Arrete de suivre ${name}`, type: Toasts.Type.MESSAGE, id: Toasts.genId() });
}

function joinFollowed() {
    if (!followedChannel) {
        Toasts.show({ message: `${followedName} n'est pas en vocal`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
        return;
    }
    joinChannel(followedChannel);
    resetInactivityTimer();
}

// ── Icone coeur ───────────────────────────────────────────────────────────────
function HeartIcon({ filled = false }: { filled?: boolean; }) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24">
            {filled ? (
                <path fill="white" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            ) : (
                <path fill="currentColor" d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z" />
            )}
        </svg>
    );
}

// ── Bouton HeaderBar ──────────────────────────────────────────────────────────
// Clic gauche = rejoindre son vocal
// Clic droit  = unfollow
function FollowHeaderButton() {
    const fid = useFollowId();
    if (!fid) return null;

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (e.button === 2) {
            // Clic droit
            unfollow();
        } else {
            // Clic gauche
            joinFollowed();
        }
    };

    return (
        <HeaderBarButton
            icon={() => <HeartIcon filled={true} />}
            tooltip={`${followedName} — Clic: rejoindre vocal | Clic droit: unfollow`}
            onClick={handleClick}
            onContextMenu={handleClick}
        />
    );
}

// ── Context menu ──────────────────────────────────────────────────────────────
const ctxPatch: NavContextMenuPatchCallback = (children, props) => {
    const userId: string | undefined = props?.user?.id;
    if (!userId) return;
    const isFollowed = followedId === userId;
    children.push(
        <Menu.MenuCheckboxItem
            id="follow-user-ctx"
            label={isFollowed ? "Unfollow User" : "Follow User"}
            checked={isFollowed}
            action={() => { if (isFollowed) unfollow(); else follow(userId); }}
        />,
        <Menu.MenuCheckboxItem
            id="follow-user-fake-mute"
            label="Fake Mute (icône muette, micro actif)"
            checked={fakeMute}
            action={toggleFakeMute}
        />,
        <Menu.MenuCheckboxItem
            id="follow-user-fake-deafen"
            label="Fake Deafen (icône sourde, audio actif)"
            checked={fakeDeafen}
            action={toggleFakeDeafen}
        />
    );
};

// ── Plugin ────────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "FollowUser",
    enabledByDefault: true,
    description: "Suit un user en vocal. Clic droit → Follow User. Coeur blanc = suivi actif (clic gauche = rejoindre, clic droit = unfollow). Inclut fake mute/fake deafen et une durée d'inactivité configurable.",
    authors: [{ name: "0ctane", id: 0n }],
    settings,

    headerBarButton: {
        icon: HeartIcon,
        render: FollowHeaderButton,
        priority: 5,
    },

    async start() {
        FluxDispatcher?.subscribe?.("VOICE_STATE_UPDATES", onOwnVoiceStateEvent);
        FluxDispatcher?.subscribe?.("AUDIO_TOGGLE_SELF_MUTE", onOwnVoiceStateEvent);
        FluxDispatcher?.subscribe?.("AUDIO_TOGGLE_SELF_DEAF", onOwnVoiceStateEvent);

        const saved = await DataStore.get(DS_KEY) as { id: string; name: string; } | null;
        if (saved?.id) {
            followedId = saved.id;
            followedName = saved.name ?? saved.id;
            followedChannel = getChannelOf(saved.id);
            startFlux();
            resetInactivityTimer();
        }
        addContextMenuPatch("user-context", ctxPatch);
        addContextMenuPatch("user-profile-actions", ctxPatch);
        addContextMenuPatch("gdm-context", ctxPatch);
    },

    stop() {
        FluxDispatcher?.unsubscribe?.("VOICE_STATE_UPDATES", onOwnVoiceStateEvent);
        FluxDispatcher?.unsubscribe?.("AUDIO_TOGGLE_SELF_MUTE", onOwnVoiceStateEvent);
        FluxDispatcher?.unsubscribe?.("AUDIO_TOGGLE_SELF_DEAF", onOwnVoiceStateEvent);
        if (fakeMute || fakeDeafen) {
            fakeMute = false;
            fakeDeafen = false;
            sendFakeVoiceState();
        }
        stopFlux();
        clearInactivityTimer();
        followedId = null; followedName = ""; followedChannel = null;
        removeContextMenuPatch("user-context", ctxPatch);
        removeContextMenuPatch("user-profile-actions", ctxPatch);
        removeContextMenuPatch("gdm-context", ctxPatch);
    },
});
