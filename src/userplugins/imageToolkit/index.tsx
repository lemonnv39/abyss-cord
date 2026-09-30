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

// Both CDN and the media proxy serve these, and per-server (guild member)
// avatars/banners live under a different path than global ones. Missing either
// is why "some avatars/banners were clickable and others weren't".
const AVATAR_URL_RE = /(?:cdn\.discordapp\.com|media\.discordapp\.net)\/(?:avatars|guilds\/\d+\/users\/\d+\/avatars|embed\/avatars)\//;
const BANNER_URL_RE = /(?:cdn\.discordapp\.com|media\.discordapp\.net)\/(?:banners|guilds\/\d+\/users\/\d+\/banners)\//;

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

type Hit = { url: string; isBanner: boolean; };

// Read an image URL from any node shape Discord uses for avatars/banners:
// a plain <img>, an SVG <image> (avatars with a status ring are drawn as SVG,
// which is NOT an HTMLImageElement — the old code missed all of these), or a
// CSS background-image (banners are often a background div).
function urlFromElement(el: Element): string | null {
    if (el instanceof HTMLImageElement) return el.currentSrc || el.src || null;
    if (typeof SVGImageElement !== "undefined" && el instanceof SVGImageElement) {
        return el.href?.baseVal || el.getAttribute("href") || el.getAttribute("xlink:href") || null;
    }
    const bg = getComputedStyle(el).backgroundImage;
    const m = bg && bg.match(/url\(["']?(https?:[^"')]+)["']?\)/);
    return m ? m[1] : null;
}

function classify(url: string): "avatar" | "banner" | null {
    if (AVATAR_URL_RE.test(url)) return "avatar";
    if (BANNER_URL_RE.test(url)) return "banner";
    return null;
}

function pointIn(r: DOMRect, x: number, y: number): boolean {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// True if the element (or a close ancestor) is itself a clickable control that
// owns the click — a <button>/<a>, a role=button/menuitem, or something with an
// aria-haspopup menu. The guild/server header draws the server banner as its
// background but IS the button that opens the server menu (Boost/Invite/Settings);
// without this guard we'd swallow that click and only show the banner, making
// "server settings" unreachable. Used for banners only (avatars are static).
function inActivationTarget(el: Element | null): boolean {
    for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
        const tag = el.tagName;
        if (tag === "BUTTON" || tag === "A") return true;
        const role = el.getAttribute("role");
        if (role === "button" || role === "menuitem" || role === "tab") return true;
        const pop = el.getAttribute("aria-haspopup");
        if (pop && pop !== "false") return true;
    }
    return false;
}

// Walk up from the clicked node; at each level inspect the element itself and
// its <img>/<image> descendants. Hit-test against the cursor so an overlay
// (status ring, hover layer) sitting on top of the real avatar/banner doesn't
// stop us, and so clicking empty card space never grabs a nearby image.
function findMedia(target: EventTarget | null, x: number, y: number): Hit | null {
    let el = target as HTMLElement | null;
    for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
        const candidates: Element[] = [el];
        if (el.querySelectorAll) candidates.push(...el.querySelectorAll("img, image"));
        for (const c of candidates) {
            const url = urlFromElement(c);
            if (!url) continue;
            const kind = classify(url);
            if (!kind) continue;
            const r = c.getBoundingClientRect();
            if (!pointIn(r, x, y)) continue;
            if (kind === "avatar" && (r.width < MIN_AVATAR_SIZE || r.height < MIN_AVATAR_SIZE)) continue;
            if (kind === "banner" && r.width < MIN_BANNER_WIDTH) continue;
            // A banner that IS (or sits inside) a clickable control — the server
            // header that opens the server menu — must keep its own click.
            if (kind === "banner" && inActivationTarget(c)) continue;
            return { url, isBanner: kind === "banner" };
        }
    }
    return null;
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
    const hit = findMedia(e.target, e.clientX, e.clientY);
    if (!hit) return;

    e.preventDefault();
    e.stopPropagation();
    openEnlarged(hit.url, hit.isBanner);
}

function onContextMenu(e: MouseEvent) {
    const hit = findMedia(e.target, e.clientX, e.clientY);
    if (!hit) return;

    e.preventDefault();
    ContextMenuApi.openContextMenu(e as any, () => <ImageToolkitMenu url={hit.url} />);
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
