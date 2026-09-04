/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addHeaderBarButton, HeaderBarButton, isHeaderBarButtonsHidden, removeHeaderBarButton, setHeaderBarButtonAlwaysVisible, setHeaderBarButtonsHidden } from "@api/HeaderBar";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";

const BUTTON_ID = "abyss-compact-mode-toggle";

function CompactIcon(props: any) {
    return (
        <svg width={props.width || 18} height={props.height || 18} viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 8h16v2H4zm0 6h16v2H4z" />
        </svg>
    );
}

function CompactModeButton() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const hidden = isHeaderBarButtonsHidden();

    return (
        <HeaderBarButton
            icon={CompactIcon}
            tooltip={hidden ? "Show all plugin buttons" : "Hide all plugin buttons"}
            onClick={() => {
                setHeaderBarButtonsHidden(!hidden);
                forceUpdate();
            }}
        />
    );
}

export default definePlugin({
    name: "CompactMode",
    enabledByDefault: false,
    description: "Hides every other plugin's header bar button behind a single toggle icon. Click it again to restore them.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["HeaderBarAPI"],

    start() {
        addHeaderBarButton(BUTTON_ID, () => <CompactModeButton />, 100);
        setHeaderBarButtonAlwaysVisible(BUTTON_ID, true);
    },

    stop() {
        setHeaderBarButtonAlwaysVisible(BUTTON_ID, false);
        removeHeaderBarButton(BUTTON_ID);
        setHeaderBarButtonsHidden(false);
    },
});
