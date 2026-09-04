/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { getMediaUrl } from "@equicordplugins/fileUpload/utils/getMediaUrl";
import definePlugin from "@utils/types";
import { Menu, RestAPI, Toasts } from "@webpack/common";

const copyImage = async (url: string) => {
    try {
        let urlObj;
        try {
            urlObj = new URL(url);
        } catch {
            urlObj = new URL(url, window.location.origin);
        }
        let fetchUrl = url;
        if (!urlObj.pathname.includes("/attachments/")) {
            urlObj.pathname = urlObj.pathname.replace(/\.(webp|webm|mp4|gif|jpg|jpeg)$/i, "") + ".png";
            urlObj.searchParams.set("size", "4096");
            fetchUrl = urlObj.toString();
        }

        let response;
        try {
            response = await fetch(fetchUrl);
        } catch {
            response = null;
        }

        if (!response || !response.ok) {
            response = await fetch(url);
        }

        const buffer = await response.arrayBuffer();
        const win = window as any;
        if (win.DiscordNative?.clipboard?.copyImage) {
            win.DiscordNative.clipboard.copyImage(new Uint8Array(buffer), url);
        } else if (win.VesktopNative?.clipboard?.copyImage) {
            win.VesktopNative.clipboard.copyImage(new Uint8Array(buffer), url);
        } else {
            const blob = new Blob([buffer], { type: "image/png" });
            navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        }
        Toasts.show(Toasts.create("Image copied to clipboard!", Toasts.Type.SUCCESS));
    } catch (e) {
        Toasts.show(Toasts.create("Failed to copy image", Toasts.Type.FAILURE));
        console.error("[FastPFP]", e);
    }
};

const saveImage = async (originalUrl: string) => {
    try {
        let urlObj;
        try {
            urlObj = new URL(originalUrl);
        } catch {
            urlObj = new URL(originalUrl, window.location.origin);
        }

        let pathname = urlObj.pathname;
        const isAnimated = pathname.includes(".gif") || pathname.includes("a_") || pathname.includes(".webm");
        const tryExts = isAnimated ? [".gif", ".png"] : [".png", ".gif"];
        let response: Response | null = null;
        let finalExt = tryExts[0];

        if (!pathname.includes("/attachments/")) {
            pathname = pathname.replace(/\.(webp|webm|mp4|gif|png|jpg|jpeg)$/i, "");
            for (const ext of tryExts) {
                urlObj.pathname = pathname + ext;
                urlObj.searchParams.set("size", "4096");
                try {
                    response = await fetch(urlObj.toString());
                } catch {
                    response = null;
                }
                if (response && response.ok) {
                    finalExt = ext;
                    break;
                }
            }
        }

        if (!response || !response.ok) {
            response = await fetch(originalUrl);
            finalExt = "." + (originalUrl.split("?")[0].split(".").pop() || "png");
        }

        const buffer = await response.arrayBuffer();
        let filename = pathname.split("/").pop() || "image";
        filename += finalExt;

        const win = window as any;
        if (win.DiscordNative?.fileManager?.saveWithDialog) {
            win.DiscordNative.fileManager.saveWithDialog(new Uint8Array(buffer), filename);
        } else {
            const blob = new Blob([buffer]);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
        }
        Toasts.show(Toasts.create("Image saved successfully!", Toasts.Type.SUCCESS));
    } catch (e) {
        Toasts.show(Toasts.create("Failed to save image", Toasts.Type.FAILURE));
        console.error("[FastPFP]", e);
    }
};

const openLink = (url: string) => window.open(url, "_blank");

const uploadImageToProfile = async (url: string, type: "avatar" | "banner") => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64data = reader.result;
            try {
                await RestAPI.patch({ url: "/users/@me", body: { [type]: base64data } });
                Toasts.show(Toasts.create(`Successfully updated your ${type}!`, Toasts.Type.SUCCESS));
            } catch (error) {
                Toasts.show(Toasts.create(`Failed to update ${type}.`, Toasts.Type.FAILURE));
                console.error("[FastPFP]", error);
            }
        };
    } catch (err) {
        Toasts.show(Toasts.create("Failed to download image.", Toasts.Type.FAILURE));
        console.error("[FastPFP]", err);
    }
};

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props) return;

    const { itemSrc, itemHref, target } = props as any;
    const url = getMediaUrl({ src: itemSrc, href: itemHref, target });
    if (!url) return;

    const group = findGroupChildrenByChildId("open-native-link", children)
        ?? findGroupChildrenByChildId("copy-link", children);

    if (group && !group.some(child => child?.props?.id === "fastpfp-avatar")) {
        group.push(
            <Menu.MenuItem label="Add To PFP" key="fastpfp-avatar" id="fastpfp-avatar" action={() => uploadImageToProfile(url, "avatar")} />
        );
        group.push(
            <Menu.MenuItem label="Add To Banner" key="fastpfp-banner" id="fastpfp-banner" action={() => uploadImageToProfile(url, "banner")} />
        );
        group.push(<Menu.MenuSeparator key="fastpfp-sep" />);
        group.push(
            <Menu.MenuItem label="Copy Image" key="fastpfp-copy-image-msg" id="fastpfp-copy-image-msg" action={() => copyImage(url)} />
        );
        group.push(
            <Menu.MenuItem label="Save Image" key="fastpfp-save-image-msg" id="fastpfp-save-image-msg" action={() => saveImage(url)} />
        );
        group.push(
            <Menu.MenuItem label="Open Link" key="fastpfp-open-link-msg" id="fastpfp-open-link-msg" action={() => openLink(url)} />
        );
    }
};

const imageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props) return;
    if ("href" in (props as any) && !(props as any).src) return;

    const url = getMediaUrl(props as any);
    if (!url) return;
    if (children.some(child => child?.props?.id === "fastpfp-group")) return;

    children.push(
        <Menu.MenuGroup id="fastpfp-group">
            <Menu.MenuItem label="Add To PFP" key="fastpfp-avatar" id="fastpfp-avatar" action={() => uploadImageToProfile(url, "avatar")} />
            <Menu.MenuItem label="Add To Banner" key="fastpfp-banner" id="fastpfp-banner" action={() => uploadImageToProfile(url, "banner")} />
            <Menu.MenuSeparator />
            <Menu.MenuItem label="Copy Image" key="fastpfp-copy-image" id="fastpfp-copy-image" action={() => copyImage(url)} />
            <Menu.MenuItem label="Save Image" key="fastpfp-save-image" id="fastpfp-save-image" action={() => saveImage(url)} />
            <Menu.MenuItem label="Open Link" key="fastpfp-open-link" id="fastpfp-open-link" action={() => openLink(url)} />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "FastPFP",
    enabledByDefault: false,
    description: "Adds context-menu actions to quickly set any image as your avatar or banner, copy it, save it, or open its link.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["ContextMenuAPI"],
    contextMenus: {
        "message": messageContextMenuPatch,
        "image-context": imageContextMenuPatch
    }
});
