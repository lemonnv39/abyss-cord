/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Ported from Nightcord's SmoothType. It's a synthetic caret, not a
 * text/letter animation: Discord's real caret is hidden
 * (`caret-color: transparent` on `[data-slate-editor]` — a stable Discord
 * data attribute from its Slate.js chat editor, not a hashed class, safe to
 * target directly) and replaced by an absolutely-positioned `<div>` whose
 * left/top/height glide via a CSS transition, repositioned from the real
 * Selection/Range on every relevant DOM event (typing, click, focus...).
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    transitionDelay: {
        description: "Caret glide duration (ms)",
        type: OptionType.NUMBER,
        default: 60,
    },
    animationType: {
        description: "Easing curve for the caret glide",
        type: OptionType.SELECT,
        options: [
            { label: "Ease", value: "ease", default: true },
            { label: "Linear", value: "linear" },
            { label: "Ease In", value: "ease-in" },
            { label: "Ease Out", value: "ease-out" },
            { label: "Ease In Out", value: "ease-in-out" },
        ],
    },
    caretColor: {
        description: "Caret color (CSS color, e.g. #ffffff)",
        type: OptionType.STRING,
        default: "#ffffff",
    },
});

const STYLE_ID = "abyss-smoothtype-style";
const CARET_ID = "abyss-smoothtype-caret";

let caretEl: HTMLDivElement | null = null;
let rafId: number | null = null;
let blinkTimeout: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;

function buildCSS(): string {
    const { transitionDelay, animationType, caretColor } = settings.store;
    return `
@keyframes abyss-smoothtype-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
}
#${CARET_ID}.is-blinking {
    animation: abyss-smoothtype-blink 1s ease-in-out infinite;
}
#${CARET_ID} {
    position: fixed;
    top: 0;
    left: 0;
    width: 2px;
    border-radius: 2px;
    background: ${caretColor};
    pointer-events: none;
    z-index: 99999;
    display: none;
    transition: left ${transitionDelay}ms ${animationType}, top ${transitionDelay}ms ${animationType}, height ${transitionDelay}ms ${animationType};
}
[data-slate-editor] {
    caret-color: transparent !important;
}
`;
}

function applyCSS() {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCSS();
    document.head.appendChild(style);
}

function getCaret(): HTMLDivElement {
    if (!caretEl) {
        caretEl = document.createElement("div");
        caretEl.id = CARET_ID;
        document.body.appendChild(caretEl);
    }
    return caretEl;
}

function startBlink() {
    getCaret().classList.add("is-blinking");
}

function stopBlink() {
    getCaret().classList.remove("is-blinking");
    if (blinkTimeout) clearTimeout(blinkTimeout);
    blinkTimeout = setTimeout(startBlink, 1000);
}

function applyCaretPosition() {
    const el = getCaret();
    if (!document.activeElement?.closest("[data-slate-editor]")) {
        el.style.display = "none";
        return;
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        el.style.display = "none";
        return;
    }

    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rects = range.getClientRects();
    let rect: DOMRect | null = rects.length > 0 ? rects[0] : null;
    if (!rect || rect.height === 0) {
        const node = range.startContainer;
        const parent = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node) as HTMLElement | null;
        if (parent) rect = parent.getBoundingClientRect();
    }
    if (!rect || rect.height === 0) {
        el.style.display = "none";
        return;
    }

    const newLeft = `${rect.right}px`;
    const newTop = `${rect.top}px`;
    if ((el.style.left !== newLeft || el.style.top !== newTop) && el.style.display !== "none") {
        stopBlink();
    }
    el.style.display = "block";
    el.style.left = newLeft;
    el.style.top = newTop;
    el.style.height = `${rect.height}px`;
}

function scheduleUpdate() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
        rafId = null;
        applyCaretPosition();
    });
}

function startObserving() {
    if (observer) return;
    observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function stopObserving() {
    observer?.disconnect();
    observer = null;
}

function onFocusIn() {
    if (document.activeElement?.closest("[data-slate-editor]")) startObserving();
    scheduleUpdate();
}

function onFocusOut() {
    stopObserving();
    getCaret().style.display = "none";
}

function onVisibilityChange() {
    if (document.hidden) stopObserving();
    else if (document.activeElement?.closest("[data-slate-editor]")) startObserving();
}

export default definePlugin({
    name: "SmoothType",
    enabledByDefault: false,
    description: "Replaces the chat input's blinking caret with one that glides smoothly between positions, ported from Nightcord.",
    authors: [{ name: "0ctane", id: 0n }],
    settings,

    start() {
        applyCSS();
        document.addEventListener("selectionchange", scheduleUpdate);
        document.addEventListener("focusin", onFocusIn, true);
        document.addEventListener("focusout", onFocusOut, true);
        document.addEventListener("keyup", scheduleUpdate, true);
        document.addEventListener("click", scheduleUpdate, true);
        document.addEventListener("visibilitychange", onVisibilityChange);
    },

    stop() {
        document.getElementById(STYLE_ID)?.remove();
        caretEl?.remove();
        caretEl = null;
        stopObserving();
        if (blinkTimeout) clearTimeout(blinkTimeout);
        if (rafId !== null) cancelAnimationFrame(rafId);
        document.removeEventListener("selectionchange", scheduleUpdate);
        document.removeEventListener("focusin", onFocusIn, true);
        document.removeEventListener("focusout", onFocusOut, true);
        document.removeEventListener("keyup", scheduleUpdate, true);
        document.removeEventListener("click", scheduleUpdate, true);
        document.removeEventListener("visibilitychange", onVisibilityChange);
    },
});
