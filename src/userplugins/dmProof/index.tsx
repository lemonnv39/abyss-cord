/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { HeaderBarButton } from "@api/HeaderBar";
import definePlugin, { PluginNative } from "@utils/types";
import { useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.DMProof as PluginNative<typeof import("./native")>;

let dmProofActive = false;

function setActive(value: boolean) {
    dmProofActive = value;
    document.body.classList.toggle("dm-proof-enabled", value);
    Native.setActive(value);
}

// Native desktop notifications (Windows toasts) are rendered by the OS, not
// by our own DOM — there's no CSS filter that can blur them. Discord (and
// Abyss's own notification API, see api/Notifications/Notifications.tsx)
// both just call the standard `new Notification(title, options)`, so we
// intercept that constructor and swap the sender name / message preview /
// avatar for generic placeholders while DMProof is active. Same privacy
// goal as the sidebar blur, just achieved by redaction instead of a filter
// since a real pixel blur isn't possible for a native OS toast.
let notificationHookInstalled = false;

function installNotificationHook() {
    if (notificationHookInstalled) return;
    notificationHookInstalled = true;

    const OriginalNotification = window.Notification;
    if (!OriginalNotification) return;

    const ProxiedNotification = new Proxy(OriginalNotification, {
        construct(target, args: [title: string, options?: NotificationOptions]) {
            if (!dmProofActive) return new target(...args);

            const [, options] = args;
            const redactedOptions: NotificationOptions = {
                ...options,
                body: "New message",
                icon: undefined,
                image: undefined,
            };
            return new target("Discord", redactedOptions);
        }
    });

    Object.defineProperty(window, "Notification", {
        value: ProxiedNotification,
        writable: true,
        configurable: true,
    });
}

function EyeIcon({ width = 20, height = 20 }: { width?: number; height?: number; }) {
    return (
        <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} fill="none" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 5C5.648 5 1 12 1 12s4.648 7 11 7 11-7 11-7-4.648-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
        </svg>
    );
}

function EyeSlashIcon({ width = 20, height = 20 }: { width?: number; height?: number; }) {
    return (
        <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width={width} height={height} fill="none" viewBox="0 0 24 24">
            <path fill="currentColor" d="M2.22 2.22a.75.75 0 0 1 1.06 0l18.5 18.5a.75.75 0 1 1-1.06 1.06l-3.56-3.56A11.18 11.18 0 0 1 12 19C5.648 19 1 12 1 12s1.81-2.73 4.69-4.95L2.22 3.28a.75.75 0 0 1 0-1.06ZM7.1 8.52A8.87 8.87 0 0 0 3.07 12 9.57 9.57 0 0 0 12 17c1.47 0 2.85-.34 4.1-.93l-1.7-1.7A3 3 0 0 1 10.63 10.6L7.1 8.52ZM12 5c1.92 0 3.7.52 5.25 1.37l-1.5 1.5A8.87 8.87 0 0 0 20.93 12a9.57 9.57 0 0 1-3.37 3.44l1.5 1.5C21.42 15.2 23 12 23 12s-4.648-7-11-7Z" />
        </svg>
    );
}

function DMProofButton() {
    const [, forceUpdate] = useState({});

    return (
        <HeaderBarButton
            icon={dmProofActive ? EyeSlashIcon : EyeIcon}
            tooltip={dmProofActive ? "MP Proof : ON — hover a DM to reveal it" : "MP Proof : OFF — click to blur your DM list"}
            selected={dmProofActive}
            onClick={() => {
                setActive(!dmProofActive);
                forceUpdate({});
            }}
        />
    );
}

export default definePlugin({
    name: "DMProof",
    enabledByDefault: false,
    description: "Blurs the avatars and names of everyone in your private messages list, redacts the sender/preview in incoming desktop notifications, and hides the sender's avatar from the Windows taskbar icon. Hover a DM to peek, click the eye in the header bar to toggle.",
    authors: [{ name: "0ctane", id: 0n }],

    headerBarButton: {
        icon: EyeIcon,
        render: DMProofButton,
        priority: 4
    },

    start() {
        setActive(false);
        installNotificationHook();
    },
    stop() {
        setActive(false);
    }
});
