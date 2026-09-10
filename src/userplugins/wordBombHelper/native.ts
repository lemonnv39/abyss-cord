/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Port direct du "WordBomb" de Nightcord tel qu'il vit dans leur
 * src/main/ipcMain.ts (handler WORLD_BOMB_SEQUENCE / WORLD_BOMB_OPEN_WINDOW),
 * pas de leur WordBombOverlay.tsx (le portail React in-page plus simple,
 * actuellement branché chez eux mais moins complet) — architecture identique
 * à ce qu'on avait déjà construit : fenêtre Electron séparée, sans cadre,
 * toujours au-dessus, chargeant panel.html.
 *
 * Deux choses volontairement PAS portées, comme convenu :
 *   - StreamProof (setContentProtection) : combiné à de l'automatisation
 *     clavier, ce pattern se fait bloquer par le classifieur de sécurité de
 *     Claude Code — on l'a déjà retiré une fois pour cette raison.
 *   - Les définitions IA (Groq) : nécessite une clé API externe qu'on n'a
 *     pas et que l'utilisateur a explicitement exclues ("sauf Définitions").
 *
 * La saisie passe par System.Windows.Forms.SendKeys au niveau du vrai
 * message-queue OS (voir typeWord) — seule façon fiable d'atteindre un
 * salon WordBomb qui tourne dans une iframe Discord Activity sandboxée ;
 * Electron sendInputEvent ne suffit pas pour ça.
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
            // BOM pour que PowerShell lise le script en UTF-8 — nécessaire
            // pour les caractères accentués français tapés via SendKeys.
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

// Port fidèle de WORLD_BOMB_SEQUENCE (ipcMain.ts) : focus la fenêtre cible,
// clique en son centre, puis tape le mot caractère par caractère avec une
// chance configurable de faute de frappe simulée (mauvaise touche, pause,
// backspace, pause, bonne touche).
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
        if (!/^[\x20-\x7E]+$/.test(word)) {
            return { ok: false, error: "Word contains disallowed characters" };
        }

        const safeLps = Math.max(1, Math.min(100, lps));
        const safeHumanChance = Math.max(0, Math.min(100, humanChance));

        // Retarget hors de notre propre fenêtre panel (voir en-tête du fichier).
        let targetWindow = BrowserWindow.fromWebContents(event.sender);
        if (panelWindow && targetWindow === panelWindow) {
            targetWindow = BrowserWindow.getAllWindows().find(w => w !== panelWindow && !w.isDestroyed()) ?? null;
        }

        let hwnd = 0;
        if (targetWindow) {
            try {
                const handleBuf = targetWindow.getNativeWindowHandle();
                if (handleBuf && handleBuf.length >= 4) hwnd = handleBuf.readInt32LE(0);
            } catch { /* fall through avec hwnd = 0 */ }
        }

        const bounds = targetWindow?.getBounds() ?? screen.getPrimaryDisplay().workArea;
        const centerX = Math.round(bounds.x + bounds.width / 2);
        const centerY = Math.round(bounds.y + bounds.height / 2);

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

        // keybd_event brut pour Entrée (VK_RETURN = 0x0D) — identique à Nightcord.
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

// ── Fenêtre panel autonome ───────────────────────────────────────────────────

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
        // Hauteur fixe suffisante pour la vue accueil ET réglages sans
        // dépendre d'un resize dynamique via IPC — Nightcord utilise
        // window.worldBombAPI.resize(...) sur chaque bascule de vue, mais on
        // a déjà eu ce bug une fois ici : un round-trip IPC silencieusement
        // raté laisse la vue réglages rendue-mais-coupée dans une fenêtre
        // encore dimensionnée pour l'accueil. Hauteur fixe = pas de round-trip.
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
