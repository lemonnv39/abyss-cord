/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, Menu, RestAPI, SelectedChannelStore, showToast, Toasts } from "@webpack/common";

// ── Settings ───────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    wallpapers: {
        type: OptionType.STRING,
        description: "Wallpapers JSON — managed by the plugin, do not edit manually",
        default: "{}",
        hidden: true,
        onChange() { _invalidateWpCache(); }
    },
    opacity: {
        type: OptionType.SLIDER,
        description: "Wallpaper opacity (0 = invisible, 1 = full)",
        markers: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        default: 0.3,
        stickToMarkers: false,
        onChange(v: number) { _cachedOpacity = v; }
    },
    blur: {
        type: OptionType.SLIDER,
        description: "Wallpaper blur (px)",
        markers: [0, 2, 5, 10, 15, 20],
        default: 0,
        stickToMarkers: false,
        onChange(v: number) { _cachedBlur = v; }
    },
    defaultWallpaper: {
        type: OptionType.STRING,
        description: "Default wallpaper URL for channels without a custom one. Empty = none.",
        default: ""
    }
});

let _cachedOpacity = 0.3;
let _cachedBlur = 0;
const cacheWpSettings = () => {
    _cachedOpacity = settings.store.opacity ?? 0.3;
    _cachedBlur = settings.store.blur ?? 0;
};

let _wpCache: Record<string, string> | null = null;
let _wpRaw = "";

function getWallpapers(): Record<string, string> {
    const raw = settings.store.wallpapers || "{}";
    if (raw === _wpRaw && _wpCache !== null) return _wpCache;
    try { _wpCache = JSON.parse(raw); } catch { _wpCache = {}; }
    _wpRaw = raw;
    return _wpCache!;
}

function _invalidateWpCache() { _wpCache = null; _wpRaw = ""; }

function saveWallpaper(channelId: string, url: string) {
    const wp = getWallpapers();
    if (url) wp[channelId] = url;
    else delete wp[channelId];
    settings.store.wallpapers = JSON.stringify(wp);
    _invalidateWpCache();
    applyWallpaper(channelId);
}

function getWallpaper(channelId: string): string {
    const wp = getWallpapers();
    return wp[channelId] || settings.store.defaultWallpaper || "";
}

function hasWallpaper(channelId: string): boolean {
    return !!getWallpapers()[channelId];
}

// ── File / URL pickers ──────────────────────────────────────────────────────────

function pickFileRaw(): Promise<File | null> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*,video/mp4,video/webm,.gif";
        input.style.display = "none";
        input.onchange = () => {
            const file = input.files?.[0];
            resolve(file || null);
            input.remove();
        };
        input.oncancel = () => { resolve(null); input.remove(); };
        document.body.appendChild(input);
        input.click();
    });
}

function promptUrl(): Promise<string | null> {
    return new Promise(resolve => {
        const url = prompt("Enter the URL for the image, gif, or video:");
        resolve(url?.trim() || null);
    });
}

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ── CSS injection ────────────────────────────────────────────────────────────────

const STYLE_ID = "abyss-channel-wallpaper-style";
const CONTAINER_ID = "abyss-channel-wallpaper-container";

function removeWallpaperElements() {
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CONTAINER_ID)?.remove();
}

let activeVideo: HTMLVideoElement | null = null;

function pauseVideo() { if (activeVideo && !activeVideo.paused) activeVideo.pause(); }
function playVideo() { if (activeVideo && activeVideo.paused && !document.hidden && document.hasFocus()) activeVideo.play().catch(() => { }); }
function handleVisChange() { if (document.hidden) pauseVideo(); else playVideo(); }
function handleFocusChange() { if (document.hasFocus()) playVideo(); else pauseVideo(); }

function applyWallpaper(channelId?: string) {
    removeWallpaperElements();

    const cid = channelId || SelectedChannelStore?.getChannelId?.();
    if (!cid) return;

    const url = getWallpaper(cid);
    if (!url) return;

    const opacity = _cachedOpacity;
    const blur = _cachedBlur;
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.startsWith("data:video/");

    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
[class*="messagesWrapper"],
[class*="chatContent"],
[class*="chat-messages"],
[class*="scroller"][class*="message"] {
    background: transparent !important;
}
#${CONTAINER_ID} {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
    opacity: ${opacity};
    ${blur > 0 ? `filter: blur(${blur}px);` : ""}
}
#${CONTAINER_ID} img,
#${CONTAINER_ID} video {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
[class*="messagesWrapper"],
[class*="chatContent"] {
    position: relative !important;
}
`.trim();
        document.head.appendChild(style);
    }

    const container = document.createElement("div");
    container.id = CONTAINER_ID;

    if (isVideo) {
        const video = document.createElement("video");
        video.src = url;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        activeVideo = video;
        container.appendChild(video);
    } else {
        activeVideo = null;
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.draggable = false;
        container.appendChild(img);
    }

    const tryInject = () => {
        const target = document.querySelector('[class*="messagesWrapper"]')
            || document.querySelector('[class*="chat-messages"]')
            || document.querySelector('[class*="chatContent"]')
            || document.querySelector('[class*="content_"][class*="chat"]');

        if (target instanceof HTMLElement && !target.closest('[class*="popout"]') && !target.closest('[class*="modal"]')) {
            if (!target.querySelector(`#${CONTAINER_ID}`)) {
                target.style.position = "relative";
                target.prepend(container);
            }
            return true;
        }
        return false;
    };

    if (!tryInject()) {
        let tick = 0;
        const observer = new MutationObserver((_, obs) => {
            if (++tick % 3 !== 0) return;
            if (tryInject()) obs.disconnect();
        });
        observer.observe(document.querySelector('[class*="chat"]') || document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 3000);
    }
}

// ── Context menu actions ───────────────────────────────────────────────────────

async function setWallpaperFromFile(channelId: string) {
    const file = await pickFileRaw();
    if (!file) return;
    try {
        const dataUrl = await fileToDataUrl(file);
        saveWallpaper(channelId, dataUrl);
        showToast("Wallpaper applied!", Toasts.Type.SUCCESS);
    } catch {
        showToast("Failed to read file.", Toasts.Type.FAILURE);
    }
}

async function setWallpaperFromUrl(channelId: string) {
    const url = await promptUrl();
    if (url) {
        saveWallpaper(channelId, url);
        showToast("Wallpaper applied!", Toasts.Type.SUCCESS);
    }
}

function removeWallpaper(channelId: string) {
    saveWallpaper(channelId, "");
    showToast("Wallpaper deleted", Toasts.Type.SUCCESS);
}

// ── Context menu patches ───────────────────────────────────────────────────────

function WallpaperIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v8.5l4-3 3 2.5 4-4 5 4V6H4zm0 12h16v-1.2l-5-4-3.8 3.8L8 14.5l-4 3V18zm5-8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
        </svg>
    );
}
const FolderIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" /></svg>
);
const LinkIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" /></svg>
);
const TrashIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
);

function buildWallpaperMenu(channelId: string): React.ReactElement {
    const has = hasWallpaper(channelId);
    const channel = ChannelStore.getChannel(channelId);
    const isDM = channel?.type === 1;

    return (
        <Menu.MenuItem id="channel-wallpaper" label="Wallpaper" icon={WallpaperIcon} leadingAccessory={WallpaperIcon}>
            <Menu.MenuItem id="wallpaper-from-file" label="From a file..." icon={FolderIcon} leadingAccessory={FolderIcon} action={() => setWallpaperFromFile(channelId)} />
            <Menu.MenuItem id="wallpaper-from-url" label="From a URL..." icon={LinkIcon} leadingAccessory={LinkIcon} action={() => setWallpaperFromUrl(channelId)} />
            {has && (
                <>
                    <Menu.MenuSeparator />
                    <Menu.MenuItem id="wallpaper-remove" label={isDM ? "Delete wallpaper" : "Delete wallpaper"} color="danger" icon={TrashIcon} leadingAccessory={TrashIcon} action={() => removeWallpaper(channelId)} />
                </>
            )}
        </Menu.MenuItem>
    );
}

const userContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: any) => {
    if (!user?.id) return;
    const channelId = (ChannelStore as any).getDMFromUserId?.(user.id);
    if (!channelId) return;
    children.push(buildWallpaperMenu(channelId));
};

const channelContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: any) => {
    if (!channel?.id) return;
    children.push(buildWallpaperMenu(channel.id));
};

// ── Plugin ─────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "ChannelWallpaper",
    enabledByDefault: false,
    authors: [Devs.rushii, Devs.Nickyux],
    description: "Set a custom background image, gif, or video for any individual channel or DM.",
    settings,

    contextMenus: {
        "user-context": userContextMenuPatch,
        "channel-context": channelContextMenuPatch,
        "gdm-context": channelContextMenuPatch,
    },

    flux: {
        CHANNEL_SELECT({ channelId }: { channelId: string; }) {
            if (channelId) setTimeout(() => applyWallpaper(channelId), 100);
            else removeWallpaperElements();
        }
    },

    start() {
        cacheWpSettings();
        const cid = SelectedChannelStore.getChannelId();
        if (cid) setTimeout(() => applyWallpaper(cid), 500);
        document.addEventListener("visibilitychange", handleVisChange);
        window.addEventListener("focus", handleFocusChange);
        window.addEventListener("blur", handleFocusChange);
    },

    stop() {
        removeWallpaperElements();
        document.removeEventListener("visibilitychange", handleVisChange);
        window.removeEventListener("focus", handleFocusChange);
        window.removeEventListener("blur", handleFocusChange);
        activeVideo = null;
    }
});
