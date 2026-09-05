/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useSettings } from "@api/Settings";
import { translateUiText } from "@utils/interfaceTranslation";
import { useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

/**
 * Wraps description-style text in Abyss's Settings UI (used by Paragraph,
 * FormSwitch, and AddonCard) so it follows Settings > Abyss > "Interface
 * language". Non-string children (JSX composites, e.g. a Paragraph with a
 * nested <a>) pass through untouched — only plain text gets translated.
 */
export function TranslatedText({ children }: { children: ReactNode; }) {
    const { interfaceLanguage } = useSettings(["interfaceLanguage"]);
    const isPlainString = typeof children === "string";
    const [text, setText] = useState(isPlainString ? children : "");

    useEffect(() => {
        if (!isPlainString) return;
        if (interfaceLanguage === "en") {
            setText(children as string);
            return;
        }

        let cancelled = false;
        // Show the original immediately; swap in the translation once (and
        // if) it arrives — never blocks or hides the setting while loading.
        setText(children as string);
        translateUiText(children as string, interfaceLanguage).then(translated => {
            if (!cancelled && translated) setText(translated);
        });
        return () => { cancelled = true; };
    }, [children, interfaceLanguage, isPlainString]);

    if (!isPlainString) return <>{children}</>;
    return <>{text}</>;
}
