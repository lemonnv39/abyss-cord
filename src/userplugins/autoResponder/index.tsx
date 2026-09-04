/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, React, RestAPI, Text, UserStore } from "@webpack/common";
import plugins from "~plugins";

const MessageStore = findByPropsLazy("getMessages");

const settings = definePluginSettings({
    isActive: {
        type: OptionType.BOOLEAN,
        description: "AutoResponder functional status",
        default: false,
    },
    groqApiKey: {
        type: OptionType.STRING,
        description: "Groq API key (free — get one at console.groq.com/keys)",
        default: "",
        placeholder: "gsk_...",
    },
    personalInfo: {
        type: OptionType.STRING,
        description: "Personal information to mention when relevant (name, age, location, etc.)",
        default: "",
    },
    writingStyle: {
        type: OptionType.STRING,
        description: "Your writing style (e.g. casual, no caps, uses slang, etc.)",
        default: "",
    },
    customInstructions: {
        type: OptionType.STRING,
        description: "Custom instructions — what to say or NOT to say",
        default: "",
    },
    blacklistedWords: {
        type: OptionType.STRING,
        description: "Topics to avoid (comma separated)",
        default: "",
    },
    blacklistedUsers: {
        type: OptionType.STRING,
        description: "User IDs to never auto-reply to (comma separated)",
        default: "",
    },
    delayMin: {
        type: OptionType.NUMBER,
        description: "Minimum reply delay (seconds)",
        default: 5,
    },
    delayMax: {
        type: OptionType.NUMBER,
        description: "Maximum reply delay (seconds)",
        default: 12,
    }
});

async function groqChat(systemPrompt: string, userText: string): Promise<string | null> {
    const apiKey = settings.store.groqApiKey?.trim();
    if (!apiKey) return null;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            temperature: 0.7,
            max_tokens: 500,
            messages: [
                { role: "system", content: "You are an ultra-customizable AutoResponder for Discord." },
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

let lastMessageId = "";
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

async function handleMessage(message: any) {
    if (!settings.store.isActive) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || message.author.id === currentUser.id) return;

    const blacklistedUsers = settings.store.blacklistedUsers?.split(",").map((id: string) => id.trim()) || [];
    if (blacklistedUsers.includes(message.author.id)) return;
    if (message.id === lastMessageId) return;

    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel || channel.type !== 1) return; // DMs only

    lastMessageId = message.id;

    const apiKey = settings.store.groqApiKey?.trim();
    if (!apiKey) return;

    try {
        let localHistory = "";
        try {
            const msgs = MessageStore.getMessages(message.channel_id).toArray().slice(-15);
            localHistory = msgs.map((m: any) => `${m.author.id === currentUser.id ? "ME" : "THEM"}: ${m.content}`).join("\n");
        } catch { }

        const prompt = `You are the user (ME). Reply to the latest message from THEM.

MY PERSONAL INFO:
${settings.store.personalInfo}

MY INSTRUCTIONS:
${settings.store.customInstructions}

TOPICS TO AVOID:
${settings.store.blacklistedWords}

RECENT HISTORY:
${localHistory}

LATEST MESSAGE: "${message.content}"

RULES:
1. Keep replies short (1-2 sentences max), no long paragraphs.
2. Only bring up personal info when actually relevant.
3. Write naturally, like a real DM reply — no verbal hesitation markers ("uh...", "hold on").
4. Match my writing style: ${settings.store.writingStyle}

Reply naturally. RETURN ONLY THE REPLY TEXT.`;

        const reply = await groqChat("", prompt);
        if (!reply || reply.startsWith("❌")) return;

        const baseDelay = Math.floor(Math.random() * (settings.store.delayMax - settings.store.delayMin + 1) + settings.store.delayMin);
        const extraDelay = reply.length > 100 ? 2 : 0;
        const totalDelay = (baseDelay + extraDelay) * 1000;

        try {
            const TypingActions = findByPropsLazy("startTyping");
            TypingActions.startTyping(message.channel_id);
        } catch { }

        const timer = setTimeout(async () => {
            pendingTimers.delete(timer);
            try {
                await RestAPI.post({ url: `/channels/${message.channel_id}/messages`, body: { content: reply } });
            } catch (e) {
                console.error("[AutoResponder] Post error:", e);
            }
        }, totalDelay);
        pendingTimers.add(timer);
    } catch (err) {
        console.error("[AutoResponder] Error:", err);
    }
}

const KeyboardIcon = (props: any) => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
        <line x1="6" y1="8" x2="6" y2="8" /><line x1="10" y1="8" x2="10" y2="8" />
        <line x1="14" y1="8" x2="14" y2="8" /><line x1="18" y1="8" x2="18" y2="8" />
        <line x1="6" y1="12" x2="6" y2="12" /><line x1="10" y1="12" x2="10" y2="12" />
        <line x1="14" y1="12" x2="14" y2="12" /><line x1="18" y1="12" x2="18" y2="12" />
        <line x1="7" y1="16" x2="17" y2="16" />
        {!props.enabled && <line x1="22" y1="2" x2="2" y2="22" stroke="var(--status-danger)" strokeWidth="2.5" />}
    </svg>
);

const AutoResponderButton: ChatBarButtonFactory = ({ type }) => {
    const [, setTick] = React.useState(0);
    const isEnabled = settings.store.isActive;
    const validChat = ["normal", "sidebar"].some(x => type.analyticsName === x);
    if (!validChat) return null;

    const toggle = () => {
        if (!isEnabled) {
            if (!settings.store.groqApiKey?.trim()) {
                openModal(props => (
                    <ModalRoot {...props} size={ModalSize.SMALL}>
                        <ModalHeader separator={false}>
                            <Text variant="heading-lg/semibold">Groq API key required</Text>
                            <ModalCloseButton onClick={props.onClose} />
                        </ModalHeader>
                        <ModalContent>
                            <Text variant="text-md/normal" style={{ marginBottom: 16 }}>
                                Set a Groq API key in AutoResponder's settings first (free — console.groq.com/keys).
                            </Text>
                        </ModalContent>
                        <div style={{ padding: "16px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                            <Button variant="primary" onClick={props.onClose}>Close</Button>
                        </div>
                    </ModalRoot>
                ));
                return;
            }
            openModal(props => (
                <ModalRoot {...props} size={ModalSize.SMALL}>
                    <ModalHeader separator={false}>
                        <Text variant="heading-lg/semibold">Enable AutoResponder?</Text>
                        <ModalCloseButton onClick={props.onClose} />
                    </ModalHeader>
                    <ModalContent>
                        <Text variant="text-md/normal" style={{ marginBottom: 16 }}>
                            An AI will automatically reply to your DMs when you're unavailable.
                        </Text>
                    </ModalContent>
                    <div style={{ padding: "16px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                        <Button variant="link" onClick={props.onClose}>Cancel</Button>
                        <Button variant="primary" onClick={() => { props.onClose(); settings.store.isActive = true; setTick(t => t + 1); }}>Enable</Button>
                    </div>
                </ModalRoot>
            ));
        } else {
            settings.store.isActive = false;
            setTick(t => t + 1);
        }
    };

    return (
        <ChatBarButton
            tooltip={`AutoResponder: ${isEnabled ? "ON" : "OFF"}`}
            onClick={toggle}
            onContextMenu={e => {
                e.preventDefault();
                openPluginModal(plugins["AutoResponder"]);
            }}
        >
            <KeyboardIcon enabled={isEnabled} style={{ color: isEnabled ? "var(--brand-experiment)" : "var(--interactive-normal)" }} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "AutoResponder",
    enabledByDefault: false,
    description: "Automatically replies to DMs using AI, matching your writing style. Requires a free Groq API key (console.groq.com/keys), set in this plugin's settings.",
    dependencies: ["ChatInputButtonAPI"],
    authors: [{ name: "0ctane", id: 0n }],
    settings,

    chatBarButton: {
        icon: () => <KeyboardIcon enabled={settings.store.isActive} />,
        render: AutoResponderButton,
    },

    flux: {
        async MESSAGE_CREATE(data: any) {
            if (!settings.store.isActive) return;
            const msg = data.message || data;
            if (msg && msg.author) handleMessage(msg);
        }
    },

    start() {
        pendingTimers.clear();
    },

    stop() {
        pendingTimers.forEach(clearTimeout);
        pendingTimers.clear();
    }
});
