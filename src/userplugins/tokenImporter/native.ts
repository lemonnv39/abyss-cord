/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, net, safeStorage } from "electron";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// Vérifie un token en interrogeant l'API officielle Discord (lecture seule,
// /users/@me). N'écrit rien, ne touche à aucun autre compte.
export async function checkToken(_: any, token: string): Promise<{ valid: boolean; user?: any; error?: string; }> {
    return new Promise(resolve => {
        try {
            const req = net.request({
                method: "GET",
                url: "https://discord.com/api/v9/users/@me",
            });
            req.setHeader("Authorization", token);

            req.on("response", res => {
                let data = "";
                res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
                res.on("end", () => {
                    if (res.statusCode === 200) {
                        try { resolve({ valid: true, user: JSON.parse(data) }); }
                        catch { resolve({ valid: false, error: "parse_error" }); }
                    } else if (res.statusCode === 401 || res.statusCode === 403) {
                        resolve({ valid: false, error: "unauthorized" });
                    } else if (res.statusCode === 429) {
                        resolve({ valid: false, error: "rate_limited" });
                    } else {
                        resolve({ valid: false, error: `http_${res.statusCode}` });
                    }
                });
            });

            req.on("error", () => resolve({ valid: false, error: "network_error" }));
            req.end();
        } catch {
            resolve({ valid: false, error: "exception" });
        }
    });
}

// Chiffrement local via Electron safeStorage — lié à cette session utilisateur
// uniquement. Pas de déchiffrement de clés d'autres applications, pas de scan
// disque : ce module ne lit/écrit que ce que CE plugin a lui-même stocké.
export async function encryptToken(_: any, token: string): Promise<string | null> {
    try {
        if (!safeStorage.isEncryptionAvailable()) return null;
        return safeStorage.encryptString(token).toString("base64");
    } catch {
        return null;
    }
}

export async function decryptToken(_: any, encryptedBase64: string): Promise<string | null> {
    try {
        if (!safeStorage.isEncryptionAvailable()) return null;
        return safeStorage.decryptString(Buffer.from(encryptedBase64, "base64"));
    } catch {
        return null;
    }
}

// Recharge la fenêtre au niveau du process principal — c'est ce que fait
// réellement Ctrl+R. Un simple `location.reload()` côté renderer ne relance
// pas proprement l'état interne de Discord après un changement de token.
export function reload(_: any): void {
    BrowserWindow.getFocusedWindow()?.webContents.reload();
}
