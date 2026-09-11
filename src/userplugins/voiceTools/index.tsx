/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Tool de modération vocale : mute/deafen/disconnect tout le monde dans un
 * salon vocal en un clic, depuis le clic droit sur le salon. Ce sont de
 * vraies actions serveur (PATCH /guilds/{id}/members/{id}, comme le fait
 * déjà VoiceChatUtilities côté Equicord) — pas un mute local — donc elles
 * exigent les permissions de modération correspondantes (Mute/Deafen/Move
 * Members). D'où le "(Permissions required)" dans chaque libellé : sans ça,
 * un manque de permission remonterait comme une 403 silencieuse, sans que
 * le clic n'ait eu l'air de rien faire.
 *
 * Exclut toujours l'auteur de l'action lui-même de la cible, même si il est
 * présent dans le salon — le but est de gérer LES AUTRES, pas de se
 * couper/muter soi-même par erreur.
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { Menu, PermissionsBits, PermissionStore, RestAPI, showToast, Toasts, UserStore, VoiceStateStore } from "@webpack/common";

// Petit délai entre chaque requête pour rester large sous le rate-limit de
// la route même sur un gros salon, sans pour autant traîner sur un petit.
const REQUEST_DELAY_MS = 120;

function othersInChannel(channel: Channel): string[] {
    const myId = UserStore.getCurrentUser().id;
    return Object.values(VoiceStateStore.getVoiceStatesForChannel(channel.id))
        .map((state: any) => state.userId as string)
        .filter(userId => userId && userId !== myId);
}

async function applyToOthers(channel: Channel, body: Record<string, any>, requiredPermission: bigint, actionName: string) {
    if (!PermissionStore.can(requiredPermission, channel)) {
        showToast(`${actionName}: missing permission in this channel.`, Toasts.Type.FAILURE);
        return;
    }

    const targetIds = othersInChannel(channel);
    if (targetIds.length === 0) {
        showToast(`${actionName}: no one else in this channel.`, Toasts.Type.MESSAGE);
        return;
    }

    let ok = 0;
    let failed = 0;
    for (const userId of targetIds) {
        try {
            await RestAPI.patch({ url: `/guilds/${channel.guild_id}/members/${userId}`, body });
            ok++;
        } catch (e) {
            failed++;
            console.error("[VoiceTools]", actionName, "failed for", userId, e);
        }
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    }

    if (failed === 0) {
        showToast(`${actionName}: done (${ok}).`, Toasts.Type.SUCCESS);
    } else if (ok === 0) {
        showToast(`${actionName}: failed for everyone — check your permissions.`, Toasts.Type.FAILURE);
    } else {
        showToast(`${actionName}: ${ok}/${ok + failed} done, ${failed} failed.`, Toasts.Type.FAILURE);
    }
}

const VoiceToolsPatch: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; } = {}) => {
    // Salons vocaux et stages uniquement.
    if (!channel || (channel.type !== 2 && channel.type !== 13)) return;
    if (othersInChannel(channel).length === 0) return;

    children.unshift(
        <Menu.MenuGroup key="abyss-voicetools-group">
            <Menu.MenuItem
                key="voicetools-mute-all"
                id="abyss-voicetools-mute-all"
                label="Mute all (Permissions required)"
                color="danger"
                action={() => applyToOthers(channel, { mute: true }, PermissionsBits.MUTE_MEMBERS, "Mute all")}
            />
            <Menu.MenuItem
                key="voicetools-deafen-all"
                id="abyss-voicetools-deafen-all"
                label="Deafen all (Permissions required)"
                color="danger"
                action={() => applyToOthers(channel, { deaf: true }, PermissionsBits.DEAFEN_MEMBERS, "Deafen all")}
            />
            <Menu.MenuItem
                key="voicetools-disconnect-all"
                id="abyss-voicetools-disconnect-all"
                label="Disconnect all (Permissions required)"
                color="danger"
                action={() => applyToOthers(channel, { channel_id: null }, PermissionsBits.MOVE_MEMBERS, "Disconnect all")}
            />
            <Menu.MenuSeparator key="abyss-voicetools-separator" />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "VoiceTools",
    enabledByDefault: false,
    description: "Right-click a voice channel to mute, deafen, or disconnect everyone in it at once. Real server-side moderation actions (not a local mute) — needs the matching permission (Mute/Deafen/Move Members) to actually take effect. Always skips yourself, even if you're in the channel.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["ContextMenuAPI"],

    contextMenus: {
        "channel-context": VoiceToolsPatch,
    },
});
