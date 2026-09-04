/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Menu, RestAPI, UserStore } from "@webpack/common";

const lockedGroups = new Set<string>();

const settings = definePluginSettings({
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications on lock/unlock and auto-kick",
        default: true
    }
});

function interceptAddMember(originalMethod: any) {
    return function (this: any, ...args: any[]) {
        const [requestData] = args;
        if (requestData?.url?.match(/^\/channels\/\d+\/recipients\/\d+$/)) {
            const urlParts = requestData.url.split("/");
            const channelId = urlParts[2];
            const targetUserId = urlParts[4];

            if (lockedGroups.has(channelId)) {
                const channel = ChannelStore.getChannel(channelId);
                const currentUserId = UserStore.getCurrentUser()?.id;

                if (channel && channel.type === 3 && channel.ownerId === currentUserId) {
                    return originalMethod.apply(this, args);
                }

                if (channel && channel.type === 3) {
                    const channelName = channel.name || "Unnamed group";
                    setTimeout(async () => {
                        try {
                            await RestAPI.del({ url: `/channels/${channelId}/recipients/${targetUserId}` });
                            if (settings.store.showNotifications) {
                                showNotification({ title: "LockGroup — Auto-kick", body: `Unauthorized member removed from locked group "${channelName}".` });
                            }
                        } catch (error) {
                            console.error("[LockGroup] Auto-kick failed:", error);
                        }
                    }, 100);

                    if (settings.store.showNotifications) {
                        showNotification({ title: "LockGroup — Unauthorized addition", body: `Detected in "${channelName}" — auto-kicking...` });
                    }
                }
            }
        }
        return originalMethod.apply(this, args);
    };
}

function toggleGroupLock(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!channel || channel.type !== 3 || !currentUserId) return;

    const channelName = channel.name || "Unnamed group";

    if (channel.ownerId !== currentUserId) {
        if (settings.store.showNotifications) {
            showNotification({ title: "LockGroup", body: "Only the group owner can lock/unlock the group." });
        }
        return;
    }

    if (lockedGroups.has(channelId)) {
        lockedGroups.delete(channelId);
        if (settings.store.showNotifications) {
            showNotification({ title: "LockGroup", body: `"${channelName}" unlocked — member additions allowed.` });
        }
    } else {
        lockedGroups.add(channelId);
        if (settings.store.showNotifications) {
            showNotification({ title: "LockGroup", body: `"${channelName}" locked — member additions blocked.` });
        }
    }
}

const LockIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z" />
    </svg>
);

const UnlockIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z" />
    </svg>
);

const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: any; }) => {
    if (!channel || channel.type !== 3) return;

    const currentUserId = UserStore.getCurrentUser()?.id;
    if (channel.ownerId !== currentUserId) return;

    const isLocked = lockedGroups.has(channel.id);
    const group = findGroupChildrenByChildId("leave-channel", children);
    if (!group) return;

    group.push(
        <Menu.MenuSeparator key="lockgroup-separator" />,
        isLocked ? (
            <Menu.MenuItem key="unlock-group" id="unlock-group" label="Unlock Group" color="brand" action={() => toggleGroupLock(channel.id)} icon={UnlockIcon} leadingAccessory={UnlockIcon} />
        ) : (
            <Menu.MenuItem key="lock-group" id="lock-group" label="Lock Group" color="danger" action={() => toggleGroupLock(channel.id)} icon={LockIcon} leadingAccessory={LockIcon} />
        )
    );
};

let originalPutMethod: any = null;

export default definePlugin({
    name: "LockGroup",
    enabledByDefault: false,
    description: "Lock a group DM you own from the context menu, so anyone who adds a new member gets auto-kicked.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch,
        "channel-context": GroupContextMenuPatch
    },

    flux: {
        MESSAGE_CREATE(event: { message: any; }) {
            const { message } = event;
            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!message || message.type !== 1) return;

            const channelId = message.channel_id;
            if (!lockedGroups.has(channelId)) return;

            const channel = ChannelStore.getChannel(channelId);
            if (!channel || channel.type !== 3 || channel.ownerId !== currentUserId) return;

            const channelName = channel.name || "Unnamed group";
            const addedUserId = message.mentions?.[0]?.id;
            const addedByUserId = message.author?.id;
            if (addedByUserId === currentUserId) return;

            if (addedUserId && addedByUserId !== currentUserId) {
                setTimeout(async () => {
                    try {
                        await RestAPI.del({ url: `/channels/${channelId}/recipients/${addedUserId}` });
                    } catch (error) {
                        console.error("[LockGroup] Security kick failed:", error);
                    }
                }, 150);

                if (settings.store.showNotifications) {
                    showNotification({ title: "LockGroup — Unauthorized addition", body: `Unauthorized member added to "${channelName}" and was removed.` });
                }
            }
        }
    },

    start() {
        if (RestAPI && RestAPI.put) {
            originalPutMethod = RestAPI.put;
            RestAPI.put = interceptAddMember(originalPutMethod);
        }
    },

    stop() {
        if (originalPutMethod && RestAPI) {
            RestAPI.put = originalPutMethod;
            originalPutMethod = null;
        }
        lockedGroups.clear();
    }
});
