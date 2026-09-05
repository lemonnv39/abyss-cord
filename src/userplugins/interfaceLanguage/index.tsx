/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * InterfaceLanguage — the actual engine behind Settings > Abyss > "Interface
 * Language" (see components/settings/tabs/vencord/InterfaceLanguageSettings.tsx
 * for the picker itself; the setting it controls, `interfaceLanguage`, lives
 * on Abyss's own core Settings, not here — this plugin has no settings UI of
 * its own on purpose, per the user's ask for a real Settings option rather
 * than a separate plugin to dig for).
 *
 * IMPORTANT LESSON FROM A PREVIOUS ATTEMPT: the first version of this feature
 * imported a translation-aware wrapper INTO the shared Paragraph, FormSwitch
 * and AddonCard components — i.e. into files that basically everything else
 * imports. That shifted the bundle's module-evaluation order enough to make
 * an unrelated top-level `ErrorBoundary.wrap(...)` call run before
 * `@webpack/common`'s lazy ErrorBoundary export was populated, throwing
 * "Cannot read properties of undefined (reading 'wrap')" and taking down
 * Abyss's entire plugin system before PluginManager even started. Do NOT
 * repeat that: never import anything into Paragraph.tsx, FormSwitch.tsx, or
 * AddonCard.tsx to hook this feature.
 *
 * This version instead runs as an ordinary plugin (imports nothing special,
 * loaded the same safe way every other plugin is) and works purely by
 * watching the DOM for three of Abyss's OWN css classes:
 *   - .vc-addon-note        — AddonCard's description div (plugin/theme cards)
 *   - .vc-text-normal       — BaseText's class for weight="normal" text,
 *                             which is exactly what Paragraph and a
 *                             FormSwitch's description Span render as (their
 *                             *titles* render with weight="medium"/"bold",
 *                             a different class, confirmed by reading
 *                             BaseText.tsx/FormSwitch.tsx/Paragraph.tsx —
 *                             not a guess about Discord's own classes).
 *   - .vc-notice-text       — Notice/Notice.Warning/Notice.Info's text div
 *                             (the toggle warnings, the "Settings Plugin"
 *                             info box).
 * All three are classes Abyss itself generates and only appear inside
 * Abyss's own UI (Settings tabs, our own plugins' modals) — never inside
 * Discord's actual chat/message DOM, which uses Discord's own unrelated
 * class names. So this can safely observe the whole document without ever
 * touching chat.
 *
 * Translating at the TEXT NODE level (not the element's whole textContent)
 * is what lets this handle a notice like "...configuring the [Settings
 * Plugin link]." — it translates the two text runs around the link and
 * leaves the actual <a> element completely untouched, instead of having to
 * skip the whole notice to avoid deleting the link.
 */

import { Settings, SettingsStore } from "@api/Settings";
import definePlugin from "@utils/types";
import { translateUiText } from "@utils/interfaceTranslation";

const SELECTOR = ".vc-addon-note, .vc-text-normal, .vc-notice-text";
const ORIGINAL_ATTR = "__ilOriginal";

// Dropdown options (Background Material, macOS vibrancy, notification
// style/position, ...) render through Discord's own Select component, not
// through any of our vc-* classes, so the selector above never sees them.
// Rather than guess at Discord's internal class names for its option list
// (which the earlier ViewIcons/ReverseImageSearch breakage in this project
// showed is exactly the kind of thing that silently breaks on updates),
// this matches candidate option elements by ARIA role and only touches ones
// whose exact text is one of Abyss's own known option labels — see
// WindowsMaterialSettings.tsx, MacVibrancySettings.tsx, NotificationSettings.tsx.
// A real Discord menu option would have to coincidentally match one of
// these exact sentences, which won't happen.
const KNOWN_OPTION_LABELS = new Set([
    // WindowsMaterialSettings.tsx
    "None",
    "Mica (incorporates system theme + desktop wallpaper to paint the background)",
    "Tabbed (variant of Mica with stronger background tinting)",
    "Acrylic (blurs the window behind Vesktop for a translucent background)",
    // MacVibrancySettings.tsx
    "No vibrancy",
    "Under Page (window tinting)",
    "Content",
    "Window",
    "Selection",
    "Titlebar",
    "Header",
    "Sidebar",
    "Tooltip",
    "Menu",
    "Popover",
    "Fullscreen UI (transparent but slightly muted)",
    "HUD (Most transparent)",
    // NotificationSettings.tsx
    "Only use Desktop notifications when Discord is not focused",
    "Always use Desktop notifications",
    "Always use Abyss notifications",
    "Bottom Right",
    "Top Right",
]);
const OPTION_SELECTOR = '[role="option"], [role="menuitem"], [role="menuitemradio"]';

function directTextNodes(el: Element): Text[] {
    const out: Text[] = [];
    el.childNodes.forEach(n => {
        if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) out.push(n as Text);
    });
    return out;
}

function revertNode(node: Text) {
    const original = (node as any)[ORIGINAL_ATTR];
    if (original !== undefined) {
        node.textContent = original;
        delete (node as any)[ORIGINAL_ATTR];
    }
}

function translateNode(node: Text, lang: string) {
    if ((node as any)[ORIGINAL_ATTR] !== undefined) return; // already translated
    const raw = node.textContent ?? "";
    const text = raw.trim();
    if (!text || text.length < 4) return;

    // A sentence broken up by an inline {expression} (e.g. "search
    // {category} words") renders as several sibling text nodes, each
    // trimmed and translated independently. Losing the leading/trailing
    // whitespace each one had — e.g. "search " → "search" — is what glued
    // adjacent words together with no space once each was swapped back in.
    const leading = raw.match(/^\s+/)?.[0] ?? "";
    const trailing = raw.match(/\s+$/)?.[0] ?? "";

    translateUiText(text, lang).then(translated => {
        if (!translated || !node.isConnected) return;
        if ((node as any)[ORIGINAL_ATTR] !== undefined) return; // raced with another pass
        (node as any)[ORIGINAL_ATTR] = node.textContent;
        node.textContent = leading + translated + trailing;
    });
}

function applyToElement(el: Element) {
    const lang = Settings.interfaceLanguage;
    const nodes = directTextNodes(el);

    if (lang === "en") {
        nodes.forEach(revertNode);
        return;
    }

    nodes.forEach(n => translateNode(n, lang));
}

// Whole-element version for dropdown options: only ever called on elements
// whose full trimmed text exactly matched a known label, so translating the
// whole thing (rather than per text node) is safe here.
function applyToKnownOption(el: Element) {
    const lang = Settings.interfaceLanguage;
    const original = (el as any)[ORIGINAL_ATTR];

    if (lang === "en") {
        if (original !== undefined) {
            el.textContent = original;
            delete (el as any)[ORIGINAL_ATTR];
        }
        return;
    }

    if (original !== undefined) return; // already translated
    const text = el.textContent?.trim();
    if (!text) return;

    translateUiText(text, lang).then(translated => {
        if (!translated || !el.isConnected) return;
        if ((el as any)[ORIGINAL_ATTR] !== undefined) return;
        (el as any)[ORIGINAL_ATTR] = el.textContent;
        el.textContent = translated;
    });
}

function scanKnownOptions(root: Element | Document) {
    const candidates = root instanceof Element && root.matches(OPTION_SELECTOR)
        ? [root, ...root.querySelectorAll(OPTION_SELECTOR)]
        : [...root.querySelectorAll(OPTION_SELECTOR)];

    for (const el of candidates) {
        const text = el.textContent?.trim();
        if (text && (KNOWN_OPTION_LABELS.has(text) || (el as any)[ORIGINAL_ATTR] !== undefined)) {
            applyToKnownOption(el);
        }
    }
}

function scan(root: Element | Document) {
    if (root instanceof Element && root.matches(SELECTOR)) applyToElement(root);
    root.querySelectorAll(SELECTOR).forEach(applyToElement);
    scanKnownOptions(root);
}

let observer: MutationObserver | null = null;

function onLanguageChange() {
    scan(document);
}

export default definePlugin({
    name: "InterfaceLanguage",
    enabledByDefault: true,
    description: "Internal engine for Settings > Abyss > Interface Language — translates the descriptions in Abyss's own Settings UI. No settings of its own; configure the language from the Abyss tab itself.",
    authors: [{ name: "0ctane", id: 0n }],

    start() {
        observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                m.addedNodes.forEach(n => {
                    if (n instanceof Element) scan(n);
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        scan(document);

        SettingsStore.addChangeListener("interfaceLanguage", onLanguageChange);
    },
    stop() {
        observer?.disconnect();
        observer = null;
        SettingsStore.removeChangeListener("interfaceLanguage", onLanguageChange);
    },
});
