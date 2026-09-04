/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

// MultiInstance itself has no UI of its own — TokenImporter calls its native
// functions (VencordNative.pluginHelpers.MultiInstance.*) to open a saved
// account in its own window. Declaring it as a dependency of TokenImporter
// is what gets this file's native.ts loaded.
export default definePlugin({
    name: "MultiInstance",
    description: "Ouvre un compte Discord déjà enregistré dans TokenImporter dans sa propre fenêtre, avec sa propre session isolée. Utilisé par TokenImporter — pas de réglage propre.",
    authors: [{ name: "0ctane", id: 0n }],
});
