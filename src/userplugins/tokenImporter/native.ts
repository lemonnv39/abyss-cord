/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, net, safeStorage } from "electron";
import { spawn } from "child_process";
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

// ── Lancer une autre install Discord locale (onglet "Comptes locaux") ──────────
// `window.open("discord://")` côté renderer ne fait rien de fiable : Electron
// ne shell-out pas vers le protocole OS pour un simple window.open, et même si
// le protocole était enregistré, il ne cible que l'install par défaut — pas
// forcément celle réellement présente sur cette machine (ex: installs dans
// C:\ProgramData\<user>\ plutôt que %LOCALAPPDATA%, comme c'est le cas ici).
// On retrouve donc directement l'exécutable réel et on le lance via son propre
// Update.exe (le lanceur Squirrel que Discord utilise lui-même), qui focus la
// fenêtre existante si l'app tourne déjà au lieu d'en ouvrir une deuxième.
const BRANCH_DIRS: Record<string, string> = {
    stable: "Discord",
    canary: "DiscordCanary",
    ptb: "DiscordPTB",
};

const BRANCH_EXE: Record<string, string> = {
    stable: "Discord.exe",
    canary: "DiscordCanary.exe",
    ptb: "DiscordPTB.exe",
};

function candidateBases(): string[] {
    const bases: string[] = [];
    if (process.env.LOCALAPPDATA) bases.push(process.env.LOCALAPPDATA);
    if (process.env.PROGRAMDATA) {
        if (process.env.USERNAME) bases.push(join(process.env.PROGRAMDATA, process.env.USERNAME));
        bases.push(process.env.PROGRAMDATA);
    }
    return bases;
}

function findInstallBase(branch: string): string | null {
    const dirName = BRANCH_DIRS[branch];
    if (!dirName) return null;
    for (const base of candidateBases()) {
        const installDir = join(base, dirName);
        if (existsSync(join(installDir, "Update.exe"))) return installDir;
    }
    return null;
}

export async function launchLocalInstall(_: any, branch: string): Promise<{ ok: boolean; error?: string; }> {
    if (process.platform !== "win32") return { ok: false, error: "unsupported_platform" };

    const exe = BRANCH_EXE[branch];
    if (!exe) return { ok: false, error: "unknown_branch" };

    const installDir = findInstallBase(branch);
    if (!installDir) return { ok: false, error: "not_found" };

    try {
        spawn(join(installDir, "Update.exe"), ["--processStart", exe], {
            detached: true,
            stdio: "ignore",
        }).unref();
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? "spawn_failed" };
    }
}
