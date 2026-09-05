/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * ImageToolkit — merges what ViewIcons, ReverseImageSearch and FastPFP were
 * each supposed to cover (click avatars/banners to enlarge them, right-click
 * for search/copy/save/copy-link) into one plugin, replacing all three.
 *
 * Those three patch Discord's own internal render code by matching regex
 * patterns against its current minified source ("find: ..." patches, or a
 * navId — "image-context" — that Discord's own menu tree has to declare on
 * its own). Both broke silently: avatars opened a popout via Discord's own
 * unrelated click handling, but the BIG avatar/banner shown inside that
 * popout wasn't wired to anything, and no "image-context" menu ever fired
 * on it, so the extra items ReverseImageSearch/FastPFP tried to inject into
 * that menu never appeared either.
 *
 * This version doesn't touch Discord's source at all — it listens for
 * clicks/right-clicks anywhere in the document and asks two questions of
 * whatever was clicked: (1) is this image actually served from Discord's
 * avatar/banner CDN paths, and (2) is it big enough to be the profile
 * card's real avatar/banner rather than a 32px list icon. Both answers come
 * from the rendered page itself (URL, computed size), not from matching
 * Discord's source structure, so a Discord update can't quietly break this
 * the way it broke the three plugins it replaces.
 */

import { Flex } from "@components/Flex";
import { openImageModal } from "@utils/discord";
import definePlugin from "@utils/types";
import { ContextMenuApi, Menu, React, Toasts } from "@webpack/common";

const AVATAR_URL_RE = /cdn\.discordapp\.com\/(avatars|guilds\/\d+\/users\/\d+\/avatars|embed\/avatars)\//;
const BANNER_URL_RE = /cdn\.discordapp\.com\/banners\//;

// Below this, treat it as a list/message avatar — those should keep opening
// Discord's own profile popout, not our image modal.
const MIN_AVATAR_SIZE = 56;
const MIN_BANNER_WIDTH = 160;

const SEARCH_ENGINES: Record<string, string> = {
    "Google Lens": "https://lens.google.com/uploadbyurl?url=",
    "Google Images": "https://www.google.com/searchbyimage?image_url=",
    Yandex: "https://yandex.com/images/search?rpt=imageview&url=",
    Bing: "https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:",
    TinEye: "https://www.tineye.com/search?url=",
    SauceNAO: "https://saucenao.com/search.php?url=",
    IQDB: "https://iqdb.org/?url=",
};

function toAbsoluteUrl(u: string): string {
    try {
        return new URL(u, window.location.href).toString();
    } catch {
        return u;
    }
}

function highResUrl(rawUrl: string, size = 1024): string {
    try {
        const u = new URL(toAbsoluteUrl(rawUrl));
        const isAnimated = u.searchParams.get("animated") === "true" || /\.gif($|\?)/i.test(u.pathname);
        u.searchParams.set("size", String(size));
        if (isAnimated) u.pathname = u.pathname.replace(/\.(png|jpe?g|webp)$/i, ".gif");
        return u.toString();
    } catch {
        return rawUrl;
    }
}

// ── Find what was actually clicked ──────────────────────────────────────────

function findAvatarImg(target: EventTarget | null): HTMLImageElement | null {
    let el = target as HTMLElement | null;
    for (let depth = 0; el && depth < 5; depth++, el = el.parentElement) {
        if (
            el instanceof HTMLImageElement &&
            AVATAR_URL_RE.test(el.currentSrc || el.src) &&
            el.clientWidth >= MIN_AVATAR_SIZE && el.clientHeight >= MIN_AVATAR_SIZE
        ) {
            return el;
        }
    }
    return null;
}

function findBannerUrl(target: EventTarget | null): string | null {
    let el = target as HTMLElement | null;
    for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
        if (el.clientWidth < MIN_BANNER_WIDTH) continue;

        if (el instanceof HTMLImageElement && BANNER_URL_RE.test(el.currentSrc || el.src)) {
            return el.currentSrc || el.src;
        }

        const bg = getComputedStyle(el).backgroundImage;
        const m = bg && bg.match(/url\(["']?(https:[^"')]+)["']?\)/);
        if (m && BANNER_URL_RE.test(m[1])) return m[1];
    }
    return null;
}

function findImageUrl(target: EventTarget | null): string | null {
    const avatar = findAvatarImg(target);
    if (avatar) return avatar.currentSrc || avatar.src;
    return findBannerUrl(target);
}

// ── Enlarge ──────────────────────────────────────────────────────────────────

// Discord's own banner aspect ratio (600x240 recommended upload size = 2.5:1)
// — without this, the modal defaults to a square box and squishes/crops a
// wide banner into it.
const BANNER_ASPECT_RATIO = 600 / 240;

function openEnlarged(rawUrl: string, isBanner: boolean) {
    try {
        const url = highResUrl(rawUrl, 1024);
        const original = highResUrl(rawUrl, 4096);
        const dimensions = isBanner
            ? { width: 1024, height: Math.round(1024 / BANNER_ASPECT_RATIO) }
            : { width: 512, height: 512 };
        openImageModal({ url, original, ...dimensions });
    } catch (e) {
        console.error("[ImageToolkit] Failed to open image:", e);
    }
}

// ── Copy / save (ported from FastPFP) ───────────────────────────────────────

async function copyImage(rawUrl: string) {
    try {
        const url = highResUrl(rawUrl, 4096);
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const win = window as any;
        if (win.DiscordNative?.clipboard?.copyImage) {
            win.DiscordNative.clipboard.copyImage(new Uint8Array(buffer), url);
        } else if (win.VesktopNative?.clipboard?.copyImage) {
            win.VesktopNative.clipboard.copyImage(new Uint8Array(buffer), url);
        } else {
            const blob = new Blob([buffer], { type: "image/png" });
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        }
        Toasts.show(Toasts.create("Image copied to clipboard!", Toasts.Type.SUCCESS));
    } catch (e) {
        Toasts.show(Toasts.create("Failed to copy image", Toasts.Type.FAILURE));
        console.error("[ImageToolkit] copyImage failed:", e);
    }
}

async function saveImage(rawUrl: string) {
    try {
        const url = highResUrl(rawUrl, 4096);
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const isGif = /\.gif($|\?)/i.test(url);
        const filename = (rawUrl.split("/").pop() || "image").split("?")[0].replace(/\.[a-z0-9]+$/i, "") + (isGif ? ".gif" : ".png");

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
        console.error("[ImageToolkit] saveImage failed:", e);
    }
}

function copyLink(rawUrl: string) {
    navigator.clipboard.writeText(toAbsoluteUrl(rawUrl)).then(() => {
        Toasts.show(Toasts.create("Link copied!", Toasts.Type.SUCCESS));
    }).catch(() => { });
}

// ── Context menu ─────────────────────────────────────────────────────────────

function ImageToolkitMenu({ url }: { url: string; }) {
    return (
        <Menu.Menu navId="image-toolkit-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Image Actions">
            <Menu.MenuItem id="it-search" label="Search Image">
                {Object.entries(SEARCH_ENGINES).map(([name, base]) => (
                    <Menu.MenuItem
                        key={name}
                        id={`it-search-${name}`}
                        label={
                            <Flex alignItems="center" gap="0.5em">
                                <img
                                    style={{ borderRadius: "50%" }}
                                    aria-hidden="true"
                                    height={16}
                                    width={16}
                                    src={`https://icons.duckduckgo.com/ip3/${new URL(base).host}.ico`}
                                />
                                {name}
                            </Flex>
                        }
                        action={() => window.open(base + encodeURIComponent(toAbsoluteUrl(url)), "_blank")}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuSeparator />
            <Menu.MenuItem id="it-copy-image" label="Copy Image" action={() => copyImage(url)} />
            <Menu.MenuItem id="it-save-image" label="Save Image" action={() => saveImage(url)} />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="it-copy-link" label="Copy Link" action={() => copyLink(url)} />
            <Menu.MenuItem id="it-open-link" label="Open Link" action={() => window.open(toAbsoluteUrl(url), "_blank")} />
        </Menu.Menu>
    );
}

// ── Event delegation ─────────────────────────────────────────────────────────

function onClick(e: MouseEvent) {
    const avatar = findAvatarImg(e.target);
    const bannerUrl = avatar ? null : findBannerUrl(e.target);
    const url = avatar ? (avatar.currentSrc || avatar.src) : bannerUrl;
    if (!url) return;

    e.preventDefault();
    e.stopPropagation();
    openEnlarged(url, !avatar);
}

function onContextMenu(e: MouseEvent) {
    const url = findImageUrl(e.target);
    if (!url) return;

    e.preventDefault();
    ContextMenuApi.openContextMenu(e as any, () => <ImageToolkitMenu url={url} />);
}

export default definePlugin({
    name: "ImageToolkit",
    enabledByDefault: false,
    description: "Makes the big avatar/banner shown in profile cards clickable to view full-size (works for animated banners too), and adds Search Image / Copy Image / Save Image / Copy Link / Open Link to their right-click menu. Replaces ViewIcons, ReverseImageSearch and FastPFP.",
    authors: [{ name: "0ctane", id: 0n }],

    start() {
        document.addEventListener("click", onClick, true);
        document.addEventListener("contextmenu", onContextMenu, true);
    },
    stop() {
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("contextmenu", onContextMenu, true);
    }
});
