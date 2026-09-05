/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Ported from Nightcord's wordBomb plugin: not the older React-in-page
 * overlay, but their more complete later version built straight into
 * ipcMain.ts — a genuinely separate, frameless, always-on-top BrowserWindow
 * loading a small standalone HTML page (panel.html), rather than a portal
 * rendered inside Discord's own window.
 *
 * Typing still goes through System.Windows.Forms.SendKeys at the real OS
 * message-queue level (see typeWord below) — same reasoning as before,
 * that's what reaches a sandboxed Activity iframe like a genuine keypress.
 * Also ported: SetForegroundWindow + a click at the window's center happen
 * FIRST, and there's a "humanChance" typo simulator (type a wrong key,
 * pause, backspace, pause, then the real one).
 *
 * One focus subtlety Nightcord's code explicitly handles, ported here too:
 * once the helper is its own window, clicking its "FIND" button makes
 * *that* window the OS-focused one — so if we typed into "whatever's
 * focused" we'd type into our own panel, not Discord. typeWord checks
 * whether the caller is our own panel window and, if so, retargets to the
 * other (Discord) window instead.
 *
 * Not ported: Nightcord's Groq-API word definitions ("Safe Mode" — needs
 * an API key we don't have) and their StreamProof screen-capture-hiding
 * toggle (setContentProtection combined with input automation is exactly
 * the pattern a stealth-control tool looks like, and got this file blocked
 * by Claude Code's own safety classifier on a prior attempt — dropped at
 * the user's own choice after that).
 */

import { BrowserWindow, screen } from "electron";
import { spawn } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import panelHtml from "file://panel.html?minify";
import wordLists from "./words.json";

const DICTIONARY: string[] = [
    ...wordLists.noob,
    ...wordLists.normal,
    ...wordLists.pro,
    ...wordLists.expert,
];

let panelWindow: BrowserWindow | null = null;

function runPowershellScript(psScript: string): Promise<void> {
    if (process.platform !== "win32") return Promise.resolve();

    const tempDir = mkdtempSync(join(tmpdir(), "abyss-wbh-"));
    const tempFile = join(tempDir, "sequence.ps1");

    return new Promise<void>((resolve, reject) => {
        try {
            // BOM so PowerShell reads the script as UTF-8 — needed for
            // accented French characters typed via SendKeys.
            writeFileSync(tempFile, "﻿" + psScript, "utf8");
            const child = spawn("powershell.exe", [
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", tempFile
            ]);
            child.on("error", err => {
                try { unlinkSync(tempFile); } catch { }
                try { rmSync(tempDir, { recursive: true, force: true }); } catch { }
                reject(err);
            });
            child.on("exit", code => {
                try { unlinkSync(tempFile); } catch { }
                try { rmSync(tempDir, { recursive: true, force: true }); } catch { }
                if (code === 0) resolve();
                else reject(new Error(`PowerShell exit code ${code}`));
            });
        } catch (e) {
            try { unlinkSync(tempFile); } catch { }
            try { rmSync(tempDir, { recursive: true, force: true }); } catch { }
            reject(e);
        }
    });
}

export async function typeWord(
    event: Electron.IpcMainInvokeEvent,
    word: string,
    lps: number,
    humanChance: number
): Promise<{ ok: boolean; error?: string; }> {
    try {
        if (process.platform !== "win32") {
            return { ok: false, error: "Windows only" };
        }
        // Our word list is filtered to plain alphabetic French words only
        // (see words.json generation), so there's no SendKeys special
        // syntax (+^%~(){}[]) to worry about escaping.
        if (!/^[a-zàâäéèêëïîôöùûüÿçœæ]+$/i.test(word)) {
            return { ok: false, error: "Word contains unexpected characters" };
        }

        const safeLps = Math.max(1, Math.min(100, lps));
        const safeHumanChance = Math.max(0, Math.min(100, humanChance));

        // Retarget away from our own panel window (see file header).
        let targetWindow = BrowserWindow.fromWebContents(event.sender);
        if (panelWindow && targetWindow === panelWindow) {
            targetWindow = BrowserWindow.getAllWindows().find(w => w !== panelWindow && !w.isDestroyed()) ?? null;
        }

        let hwnd = 0;
        let centerX: number;
        let centerY: number;

        if (targetWindow) {
            try {
                const handleBuf = targetWindow.getNativeWindowHandle();
                if (handleBuf && handleBuf.length >= 4) hwnd = handleBuf.readInt32LE(0);
            } catch { /* fall through with hwnd = 0 */ }
            const b = targetWindow.getBounds();
            centerX = Math.round(b.x + b.width / 2);
            centerY = Math.round(b.y + b.height / 2);
        } else {
            const point = screen.getCursorScreenPoint();
            centerX = point.x;
            centerY = point.y;
        }

        const minMs = Math.max(10, Math.round(1000 / (safeLps * 1.5)));
        const maxMs = Math.max(minMs + 1, Math.round(1000 / safeLps));
        const baseMs = Math.round((minMs + maxMs) / 2);

        const lines: string[] = [
            "$ErrorActionPreference = \"Stop\"",
            "try {",
            "  Add-Type -AssemblyName System.Windows.Forms",
            "  Add-Type -AssemblyName System.Drawing",
            "  $sig = '[DllImport(\"user32.dll\")] public static extern void mouse_event(uint a, uint b, uint c, uint d, uint e); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'",
            "  Add-Type -MemberDefinition $sig -Name WinAPI -Namespace Abyss -ErrorAction SilentlyContinue",
            `  $handle = [IntPtr]${hwnd}`,
            "  if ($handle -ne [IntPtr]::Zero) {",
            "    [Abyss.WinAPI]::SetForegroundWindow($handle) | Out-Null",
            "    Start-Sleep -Milliseconds 10",
            "  }",
            `  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${centerX}, ${centerY})`,
            "  [Abyss.WinAPI]::mouse_event(2, 0, 0, 0, 0)",
            "  [Abyss.WinAPI]::mouse_event(4, 0, 0, 0, 0)",
            "  Start-Sleep -Milliseconds 10",
        ];

        for (const char of word) {
            if (safeHumanChance > 0) {
                lines.push(`  if ((Get-Random -Minimum 1 -Maximum 101) -le ${safeHumanChance}) {`);
                lines.push("    [System.Windows.Forms.SendKeys]::SendWait('x')");
                lines.push(`    Start-Sleep -Milliseconds ${baseMs}`);
                lines.push("    [System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE}')");
                lines.push(`    Start-Sleep -Milliseconds ${baseMs}`);
                lines.push("  }");
            }
            lines.push(`  [System.Windows.Forms.SendKeys]::SendWait('${char.replace(/'/g, "''")}')`);
            lines.push(`  Start-Sleep -Milliseconds (Get-Random -Minimum ${minMs} -Maximum ${maxMs})`);
        }

        // Raw keybd_event for Enter (VK_RETURN = 0x0D) instead of SendKeys'
        // {ENTER} — matches Nightcord's version, functionally equivalent.
        lines.push(
            "  [Abyss.WinAPI]::keybd_event(0x0D, 0x1C, 0, [UIntPtr]::Zero)",
            "  Start-Sleep -Milliseconds 20",
            "  [Abyss.WinAPI]::keybd_event(0x0D, 0x1C, 2, [UIntPtr]::Zero)",
            "} catch { exit 1 }"
        );

        await runPowershellScript(lines.join("\r\n"));
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

// ── Standalone panel window ─────────────────────────────────────────────────

function preloadPath(): string {
    const dir = join(tmpdir(), "abyss-wbh-preload");
    const file = join(dir, "preload.js");
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, [
            'const { contextBridge, ipcRenderer } = require("electron");',
            'contextBridge.exposeInMainWorld("wbhAPI", {',
            '  typeWord: (word, lps, humanChance) => ipcRenderer.invoke("VencordPluginNative_WordBombHelper_typeWord", word, lps, humanChance),',
            '  closeWindow: () => ipcRenderer.invoke("VencordPluginNative_WordBombHelper_closeWindow"),',
            '  resize: (w, h) => ipcRenderer.invoke("VencordPluginNative_WordBombHelper_resizeWindow", w, h),',
            "});",
        ].join("\n"), "utf-8");
    } catch { /* best effort */ }
    return file;
}

export async function openWindow(_: any): Promise<{ status: "opened" | "closed"; }> {
    if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.close();
        panelWindow = null;
        return { status: "closed" };
    }

    panelWindow = new BrowserWindow({
        // Tall enough for the settings view (LPS/typo sliders, theme
        // input, play style dropdown, checkbox, back button) without
        // needing a dynamic resize — a previous version tried resizing the
        // window on view toggle via IPC, but that round-trip silently
        // failing left the settings view rendered-but-clipped inside a
        // window still sized for the home view, which looked exactly like
        // "the settings page doesn't open." Fixed height avoids that.
        width: 326,
        height: 440,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: preloadPath(),
            sandbox: false,
        },
    });

    const html = panelHtml.replace('"__DICTIONARY_PLACEHOLDER__"', JSON.stringify(DICTIONARY));
    const base64Html = Buffer.from(html).toString("base64");
    await panelWindow.loadURL(`data:text/html;base64,${base64Html}`);

    panelWindow.on("closed", () => {
        panelWindow = null;
    });

    return { status: "opened" };
}

export function closeWindow(_: any) {
    if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.close();
    }
    panelWindow = null;
}

export function resizeWindow(_: any, width: number, height: number) {
    if (!panelWindow || panelWindow.isDestroyed()) return;
    const safeW = Math.max(200, Math.min(800, Math.round(width)));
    const safeH = Math.max(100, Math.min(800, Math.round(height)));
    panelWindow.setSize(safeW, safeH);
}
