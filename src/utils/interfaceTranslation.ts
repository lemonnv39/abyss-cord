/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Backs Settings > Abyss > "Interface language". Translates the DESCRIPTIVE
 * text in Abyss's own Settings UI (Paragraph, FormSwitch descriptions,
 * plugin/theme card descriptions in AddonCard) automatically, through the
 * same public Google Translate endpoint the stock "Translate" plugin uses —
 * no API key, no dictionary to maintain for 347+ plugin descriptions.
 *
 * This module only ever touches DISPLAY TEXT rendered by three shared
 * components (Paragraph, FormSwitch, AddonCard) — never a plugin's actual
 * source, settings values, or behavior, and never anything outside Abyss's
 * own Settings UI (chat, messages, etc. don't render through these).
 */

import { DataStore } from "@api/index";

const CACHE_KEY = "interfaceLanguage-translation-cache";
const GOOGLE_KEY = "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA"; // same public key the stock Translate plugin uses

let cache: Record<string, Record<string, string>> = {};
let cacheReady: Promise<void> | null = null;

function ensureCacheLoaded(): Promise<void> {
    if (!cacheReady) {
        cacheReady = DataStore.get<typeof cache>(CACHE_KEY).then(saved => {
            cache = saved ?? {};
        }).catch(() => { cache = {}; });
    }
    return cacheReady;
}

let saveTimeout: ReturnType<typeof setTimeout> | undefined;
function persistCache() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        DataStore.set(CACHE_KEY, cache).catch(() => { });
    }, 1000);
}

/**
 * Translates `text` (assumed English) into `target` ("fr", ...), using a
 * persisted cache so any given string is only ever fetched once. Returns
 * `null` on failure (caller should keep showing the original English text).
 */
export async function translateUiText(text: string, target: string): Promise<string | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;

    await ensureCacheLoaded();
    const bucket = cache[target] ??= {};
    if (bucket[trimmed]) return bucket[trimmed];

    try {
        const url = "https://translate-pa.googleapis.com/v1/translate?" + new URLSearchParams({
            "params.client": "gtx",
            "dataTypes": "TRANSLATION",
            "key": GOOGLE_KEY,
            "query.sourceLanguage": "en",
            "query.targetLanguage": target,
            "query.text": trimmed,
        });
        const res = await fetch(url);
        if (!res.ok) return null;

        const data = await res.json();
        const translated: string | undefined = data?.translation;
        if (!translated) return null;

        bucket[trimmed] = translated;
        persistCache();
        return translated;
    } catch {
        return null;
    }
}
