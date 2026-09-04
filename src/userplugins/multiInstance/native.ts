/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, session } from "electron";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

// MultiInstance — opens an account already saved in TokenImporter in its own
// Discord window, with its own session (persist:abyss-mi-{userId}).
//
// Unlike some implementations of this feature that use webSecurity:false and
// strip CSP globally, this version keeps Chromium's same-origin policy intact
// and grants mic/camera through a real permission handler scoped to this one
// session — no broad security relaxation just to make the window work.

const openWindows = new Map<string, BrowserWindow>();
const activePreloads = new Set<string>();

const VALID_DOMAINS = new Set(["discord.com", "ptb.discord.com", "canary.discord.com"]);

function preloadDir(): string {
    const dir = join(app.getPath("userData"), "abyss-mi-preloads");
    mkdirSync(dir, { recursive: true });
    return dir;
}

// Writes a preload file that sets the token in localStorage BEFORE Discord's
// own JS starts — a plain executeJavaScript() after dom-ready arrives too
// late, Discord has already decided there is no session. The file is removed
// when the window closes (see win.once("closed")).
function createTokenPreload(token: string): string {
    const dir = preloadDir();

    // Clean up orphaned preloads from a previous session (crash, etc.) — never
    // one still referenced by an open window.
    try {
        for (const f of readdirSync(dir)) {
            if (!/^token-preload-\d+\.js$/.test(f)) continue;
            const full = join(dir, f);
            if (!activePreloads.has(full)) {
                try { unlinkSync(full); } catch { }
            }
        }
    } catch { }

    const cleanToken = String(token || "").trim().replace(/^"+|"+$/g, "");
    const tokenLiteral = JSON.stringify(cleanToken);

    const innerLines = [
        "(function() {",
        "  var RAW_TOKEN = " + tokenLiteral + ";",
        "  if (!RAW_TOKEN || RAW_TOKEN === 'undefined') return;",
        "  var q = JSON.stringify(RAW_TOKEN);",
        "  try { localStorage.setItem('token', q); } catch(e) {}",
        "  try { localStorage.setItem('default_token', q); } catch(e) {}",
        "  try {",
        "    if ((location.pathname.indexOf('/login') >= 0 || location.pathname === '/') && !window.__mi_redirected) {",
        "      window.__mi_redirected = true;",
        "      location.href = 'https://discord.com/channels/@me';",
        "    }",
        "  } catch(e) {}",
        "})();"
    ].join("\n");
    const innerLiteral = JSON.stringify(innerLines);

    const script = [
        "// Abyss MultiInstance - token preload",
        "(function() {",
        "  try {",
        "    var wf = null;",
        "    try { wf = require('electron').webFrame; } catch(e) {}",
        "    if (!wf) { try { wf = require('electron/renderer').webFrame; } catch(e) {} }",
        "    if (wf) { wf.executeJavaScript(" + innerLiteral + ").catch(function(){}); }",
        "  } catch(e) {}",
        "})();"
    ].join("\n");

    const filePath = join(dir, "token-preload-" + Date.now() + ".js");
    writeFileSync(filePath, script, "utf-8");
    activePreloads.add(filePath);
    return filePath;
}

// Permission handler scoped to THIS session only — cleaner than stripping
// CSP/Permissions-Policy globally: mic and camera work without a prompt (like
// in the main window), nothing else is relaxed.
function grantMediaPermissions(ses: Electron.Session) {
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
        callback(permission === "media" || permission === "microphone" || permission === "camera" || permission === "display-capture");
    });
    ses.setPermissionCheckHandler((_wc, permission) => {
        return permission === "media" || permission === "microphone" || permission === "camera" || permission === "display-capture";
    });
}

export async function openInstanceWindow(
    _: any,
    token: string,
    userId: string,
    username = "",
    domain = "discord.com"
): Promise<{ ok: boolean; error?: string; }> {
    try {
        const existing = openWindows.get(userId);
        if (existing && !existing.isDestroyed()) {
            existing.show();
            existing.focus();
            return { ok: true };
        }

        const ses = session.fromPartition(`persist:abyss-mi-${userId}`, { cache: true });
        grantMediaPermissions(ses);

        // Block "browser handoff" — meaningless in a window already signed in
        // via token, and it could mix this instance up with the main window's
        // account.
        ses.webRequest.onBeforeRequest({ urls: ["*://discord.com/handoff*", "*://*.discord.com/handoff*"] }, (_d, cb) => cb({ cancel: true }));

        const preloadPath = createTokenPreload(token);
        ses.setPreloads([preloadPath]);

        // Abyss's patched BrowserWindow constructor (src/main/patcher.ts) sees
        // any window with both a preload AND a title and overwrites
        // process.env.DISCORD_PRELOAD with whatever we passed as `preload`
        // (our own preload.js) — clobbering the *real* Discord core preload
        // path it held since the main window was created, which every window's
        // preload.js relies on to chain-load Discord's native bindings. Save
        // it now, restore it right after construction.
        const realDiscordPreload = process.env.DISCORD_PRELOAD;

        const win = new BrowserWindow({
            width: 1280,
            height: 800,
            minWidth: 940,
            minHeight: 500,
            autoHideMenuBar: true,
            backgroundColor: "#313338",
            title: `Discord [${username || userId}]`,
            webPreferences: {
                session: ses,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                // This file ships bundled into dist/desktop/patcher.js, right next
                // to preload.js — same directory Abyss's own main window preload
                // lives in. Pointing here (instead of leaving preload unset) is
                // what makes the instance run Abyss itself, not bare Discord:
                // Abyss's preload.js injects renderer.js (all plugins) into the
                // page, then chain-loads Discord's own real preload via
                // process.env.DISCORD_PRELOAD — already set once, by the main
                // window, for the lifetime of this process.
                preload: join(__dirname, "preload.js"),
                // Deliberately absent: webSecurity:false. The same-origin
                // policy stays on — no reason to turn it off just to show
                // discord.com in its own session.
            },
        });

        if (realDiscordPreload !== undefined) process.env.DISCORD_PRELOAD = realDiscordPreload;

        openWindows.set(userId, win);

        win.once("closed", () => {
            openWindows.delete(userId);
            activePreloads.delete(preloadPath);
            try { unlinkSync(preloadPath); } catch { }
            // Stop this session's service workers so push notifications end
            // once the instance is closed.
            ses.clearStorageData({ storages: ["serviceworkers"] }).catch(() => { });
        });

        const wc = win.webContents;

        // Redundant injection: the preload sets the token before Discord even
        // starts, but we repeat it on every (re)navigation just in case (e.g.
        // reconnect after a network drop).
        const cleanTok = String(token || "").trim().replace(/^"+|"+$/g, "");
        const safeTok = JSON.stringify(cleanTok);
        const injectJs = `(function(){
            try {
                var raw = ${safeTok};
                if (!raw || raw === "undefined") return;
                var q = JSON.stringify(raw);
                localStorage.setItem("token", q);
                localStorage.setItem("default_token", q);
                if ((location.pathname.indexOf("/login") >= 0 || location.pathname === "/") && !window.__mi_redirected) {
                    window.__mi_redirected = true;
                    location.href = "https://discord.com/channels/@me";
                }
            } catch(e) {}
        })();`;
        wc.on("dom-ready", () => wc.executeJavaScript(injectJs).catch(() => { }));
        wc.on("did-navigate", () => wc.executeJavaScript(injectJs).catch(() => { }));

        wc.on("page-title-updated", (e, title) => {
            const clean = title.replace(/^\(\d+\)\s*/, "").replace(/\s*\[.*\]$/, "");
            win.setTitle(`${clean} [${username || userId}]`);
            e.preventDefault();
        });

        // Stay on discord.com/ptb/canary — any other link opens in the system
        // browser instead of inside this window.
        wc.on("will-navigate", (e, url) => {
            if (url.includes("/handoff") || !/^https:\/\/(ptb\.|canary\.)?discord\.com/.test(url)) e.preventDefault();
        });
        wc.setWindowOpenHandler(({ url }) => {
            if (url.includes("/handoff")) return { action: "deny" };
            if (url.startsWith("http")) require("electron").shell.openExternal(url);
            return { action: "deny" };
        });

        const targetDomain = VALID_DOMAINS.has(domain) ? domain : "discord.com";
        await win.loadURL(`https://${targetDomain}/channels/@me`);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

export async function closeInstance(_: any, userId: string): Promise<void> {
    const win = openWindows.get(userId);
    if (win && !win.isDestroyed()) win.close();
}

export async function getOpenInstances(_: any): Promise<string[]> {
    return [...openWindows.entries()].filter(([, w]) => !w.isDestroyed()).map(([id]) => id);
}
