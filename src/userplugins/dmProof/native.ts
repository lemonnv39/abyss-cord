/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow } from "electron";

// Discord bakes the DM sender's avatar (with the unread badge) into a single
// image and hands it to BrowserWindow#setOverlayIcon, which Windows shows on
// the taskbar button — before you've even opened the conversation. That's a
// native Windows taskbar API called from the main process, so there's no
// renderer-side hook for it like there is for desktop notifications; we
// patch the method itself here and drop the icon whenever DMProof is active.
let dmProofActive = false;

export function setActive(_: any, active: boolean) {
    dmProofActive = active;
}

const originalSetOverlayIcon = BrowserWindow.prototype.setOverlayIcon;
BrowserWindow.prototype.setOverlayIcon = function (overlay, description) {
    return originalSetOverlayIcon.call(this, dmProofActive ? null : overlay, description);
};
