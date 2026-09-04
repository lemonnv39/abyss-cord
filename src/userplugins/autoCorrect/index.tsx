/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import definePlugin, { OptionType } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";
import plugins from "~plugins";

// ── Settings ───────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    isActive: {
        type: OptionType.BOOLEAN,
        description: "Enable automatic correction",
        default: false,
    },
    groqApiKey: {
        type: OptionType.STRING,
        description: "Groq API key (free — get one at console.groq.com/keys)",
        default: "",
        placeholder: "gsk_...",
    },
    language: {
        type: OptionType.SELECT,
        description: "Correction language",
        options: [
            { label: "English", value: "en", default: true },
            { label: "French", value: "fr" },
            { label: "Spanish", value: "es" },
            { label: "German", value: "de" },
            { label: "Italian", value: "it" },
            { label: "Portuguese", value: "pt" },
        ],
    },
    aggressiveness: {
        type: OptionType.SELECT,
        description: "Correction level",
        options: [
            { label: "Soft — obvious mistakes only", value: "low", default: true },
            { label: "Normal — mistakes + style", value: "medium" },
            { label: "Aggressive — full rewrite", value: "high" },
        ],
        default: "low",
    },
});

// ── Groq chat completion ──────────────────────────────────────────────────────

async function groqChat(systemPrompt: string, userText: string): Promise<string | null> {
    const apiKey = settings.store.groqApiKey?.trim();
    if (!apiKey) return null;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            temperature: 0,
            max_tokens: 512,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userText },
            ],
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Groq API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? null;
}

const LANG_PROMPTS: Record<string, string> = {
    fr: "Tu es un correcteur orthographique. Corrige UNIQUEMENT les fautes d'orthographe et de grammaire. Retourne le texte corrigé sans explication ni guillemets. INTERDIT: ajouter des mots, changer le sens, reformuler. Si le texte est correct, retourne-le identique.",
    en: "You are a spell-checker. Fix ONLY spelling and grammar mistakes. Return the corrected text without explanation or quotes. FORBIDDEN: adding words, changing meaning, rephrasing. If already correct, return as-is.",
    es: "Eres un corrector ortográfico. Corrige SOLO errores ortográficos y gramaticales. Devuelve el texto corregido sin explicación. PROHIBIDO: añadir palabras, cambiar el sentido.",
    de: "Du bist ein Rechtschreibprüfer. Korrigiere NUR Rechtschreib- und Grammatikfehler. Gib den korrigierten Text ohne Erklärung zurück. VERBOTEN: Wörter hinzufügen, Bedeutung ändern.",
    it: "Sei un correttore ortografico. Correggi SOLO errori ortografici e grammaticali. Restituisci il testo corretto senza spiegazioni. VIETATO: aggiungere parole, cambiare il significato.",
    pt: "Você é um corretor ortográfico. Corrija SOMENTE erros ortográficos e gramaticais. Retorne o texto corrigido sem explicação. PROIBIDO: adicionar palavras, mudar o sentido.",
};

const AGGR_SUFFIX: Record<string, string> = {
    low: " STRICT INSTRUCTION: DO NOT FIX STYLE. ONLY fix obvious typos and basic grammar. DO NOT change the choice of words. KEEP THE TEXT AS IDENTICAL AS POSSIBLE. Return ONLY the text.",
    medium: " Fix mistakes and slightly improve clarity if necessary, but don't change the meaning.",
    high: " Fix everything and rewrite for perfect, fluid, and professional text.",
};

async function correctText(text: string): Promise<string> {
    if (text.trim().length < 3) return text;

    const lang = settings.store.language ?? "en";
    const aggr = settings.store.aggressiveness ?? "low";
    const systemPrompt = (LANG_PROMPTS[lang] ?? LANG_PROMPTS.en) + (AGGR_SUFFIX[aggr] ?? "");

    try {
        const corrected = await groqChat(systemPrompt, text);

        if (!corrected || corrected.trim() === "" || corrected === text) return text;
        if (corrected.toLowerCase().includes("correction:") || corrected.toLowerCase().includes("text:")) return text;
        if (corrected.length > text.length * 1.5 || corrected.length < text.length * 0.4) return text;

        if (aggr === "low") {
            const srcWords = text.trim().split(/\s+/).filter(w => w.length > 0).length;
            const corrWords = corrected.trim().split(/\s+/).filter(w => w.length > 0).length;
            if (Math.abs(corrWords - srcWords) > Math.max(1, Math.floor(srcWords * 0.15))) {
                return text;
            }
        }
        return corrected.replace(/^"(.*)"$/, "$1").trim();
    } catch (e: any) {
        console.warn("[AutoCorrect] Error correction:", e.message);
        return text;
    }
}

// ── Chat Bar Button ────────────────────────────────────────────────────────────

function AutoCorrectIcon({ enabled }: { enabled: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                fill="currentColor"
                d="M8.87 2.31A.5.5 0 0 1 9.34 2h10.92c.36 0 .6.36.47.69l-.6 1.5a.5.5 0 0 1-.47.31h-4.28l-4.17 15h4.05c.36 0 .6.36.47.69l-.6 1.5a.5.5 0 0 1-.47.31H3.74a.5.5 0 0 1-.47-.69l.6-1.5a.5.5 0 0 1 .47-.31h4.28l4.17-15H8.74a.5.5 0 0 1-.47-.69l.6-1.5Z"
            />
            {!enabled && (
                <line
                    x1="22"
                    y1="2"
                    x2="2"
                    y2="22"
                    stroke="var(--status-danger, #ed4245)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                />
            )}
        </svg>
    );
}

const AutoCorrectChatBarButton: ChatBarButtonFactory = ({ type }) => {
    const { isActive } = settings.use(["isActive"]);
    const validChat = ["normal", "sidebar"].some(x => type.analyticsName === x);
    if (!validChat) return null;

    const toggle = () => {
        if (!isActive && !settings.store.groqApiKey?.trim()) {
            showToast("Set a Groq API key in AutoCorrect's settings first.", Toasts.Type.FAILURE);
            return;
        }
        settings.store.isActive = !settings.store.isActive;
    };

    const tooltip = isActive
        ? "AutoCorrect: enabled — click to disable"
        : "AutoCorrect: disabled — click to enable";

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={toggle}
            onContextMenu={e => {
                e.preventDefault();
                openPluginModal(plugins["AutoCorrect"]);
            }}
        >
            <AutoCorrectIcon enabled={isActive} />
        </ChatBarButton>
    );
};

// ── Plugin ─────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "AutoCorrect",
    enabledByDefault: false,
    description: "Automatically corrects spelling and grammar before sending. Requires a free Groq API key (console.groq.com/keys), set in this plugin's settings.",
    dependencies: ["MessageEventsAPI", "ChatInputButtonAPI"],
    authors: [{ name: "0ctane", id: 0n }],
    settings,

    chatBarButton: {
        icon: () => <AutoCorrectIcon enabled={settings.store.isActive} />,
        render: AutoCorrectChatBarButton,
    },

    async onBeforeMessageSend(_channelId: string, message: { content: string; }, options?: any) {
        if (!settings.store.isActive) return;
        if (!message?.content || message.content.trim().length < 3) return;

        const corrected = await correctText(message.content);
        if (corrected && corrected !== message.content) {
            message.content = corrected;
            if (options && typeof options.content === "string") {
                options.content = corrected;
            }
        }
    },
});
