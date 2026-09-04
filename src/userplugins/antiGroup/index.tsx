/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when auto-leaving a group",
        default: true
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Delay before leaving the group (in milliseconds)",
        default: 1000,
        min: 100,
        max: 10000
    },
    whitelist: {
        type: OptionType.STRING,
        description: "Allowed user IDs (comma-separated) — groups created by, or containing, these users won't be auto-left",
        default: ""
    },
    autoReply: {
        type: OptionType.BOOLEAN,
        description: "Send a message before leaving",
        default: true
    },
    replyMessage: {
        type: OptionType.STRING,
        description: "Message to send before leaving",
        default: "I do not wish to be added to groups. Please contact me privately."
    }
});

async function leaveGroupDM(channelId: string) {
    try {
        const channel = ChannelStore.getChannel(channelId);
        const channelName = channel?.name || "Unnamed group";

        if (settings.store.autoReply && settings.store.replyMessage.trim()) {
            try {
                await RestAPI.post({ url: Constants.Endpoints.MESSAGES(channelId), body: { content: settings.store.replyMessage } });
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (e) {
                console.error("[AntiGroup] Failed to send auto-reply:", e);
            }
        }

        await RestAPI.del({ url: Constants.Endpoints.CHANNEL(channelId) });

        if (settings.store.showNotifications) {
            showNotification({ title: "AntiGroup — Group left", body: `You have automatically left "${channelName}".` });
        }
    } catch (error) {
        const channel = ChannelStore.getChannel(channelId);
        const channelName = channel?.name || "Unknown group";
        console.error(`[AntiGroup] Failed to leave "${channelName}" (${channelId}):`, error);
        if (settings.store.showNotifications) {
            showNotification({ title: "AntiGroup — Error", body: `Could not automatically leave "${channelName}".` });
        }
    }
}

function isUserWhitelisted(userId: string): boolean {
    const whitelist = settings.store.whitelist.split(",").map(id => id.trim()).filter(id => id.length > 0);
    return whitelist.includes(userId);
}

function wasRecentlyAdded(channel: any, currentUserId: string): boolean {
    if (channel.type !== 3) return false;
    return channel.ownerId !== currentUserId;
}

export default definePlugin({
    name: "AntiGroup",
    enabledByDefault: false,
    description: "Automatically leaves group DMs the moment you're added to one, unless the owner or a member is whitelisted.",
    authors: [{ name: "0ctane", id: 0n }],
    settings,

    flux: {
        CHANNEL_CREATE(event: { channel: any; }) {
            if (!settings.store.showNotifications && !settings.store.autoReply) { /* still runs, notifications are opt-in */ }
            const { channel } = event;
            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!channel || !currentUserId) return;
            if (channel.type !== 3) return;
            if (!wasRecentlyAdded(channel, currentUserId)) return;

            if (channel.ownerId && isUserWhitelisted(channel.ownerId)) return;
            const whitelistedMember = channel.recipients?.find((recipient: any) => isUserWhitelisted(recipient.id));
            if (whitelistedMember) return;

            if (settings.store.showNotifications) {
                showNotification({
                    title: "AntiGroup — Group detected",
                    body: `Added to "${channel.name || "Unnamed"}" — auto-leaving in ${settings.store.delay / 1000}s.`
                });
            }

            setTimeout(() => leaveGroupDM(channel.id), settings.store.delay);
        }
    }
});
