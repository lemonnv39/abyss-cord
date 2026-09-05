/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useSettings } from "@api/Settings";
import { Heading } from "@components/Heading";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { Select } from "@webpack/common";

export function InterfaceLanguageSettings() {
    const settings = useSettings(["interfaceLanguage"]);

    return (
        <>
            <Heading tag="h5">Interface Language</Heading>
            <Paragraph className={Margins.bottom8}>
                Translates the descriptions in Abyss's Settings UI (this tab, Plugins — including
                plugins that aren't Abyss's own —, Themes, Changelog, Cloud, Backup & Restore,
                Patch Helper) into the selected language. Toggle titles and plugin names stay in
                English on purpose. Translated with Google Translate; each string is translated
                once and cached, so this only touches display text — it never changes any
                plugin's code or behavior.
            </Paragraph>

            <Select
                placeholder="English"
                options={[
                    { label: "English (original)", value: "en", default: true },
                    { label: "Français", value: "fr" },
                ]}
                closeOnSelect={true}
                select={v => (settings.interfaceLanguage = v)}
                isSelected={v => v === settings.interfaceLanguage}
                serialize={s => s}
            />
        </>
    );
}
