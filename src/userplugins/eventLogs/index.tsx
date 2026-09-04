/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Forms, GuildStore, React, RelationshipStore, showToast, Toasts, UserStore } from "@webpack/common";

// Local activity log — everything is stored client-side only (localStorage),
// nothing is sent anywhere. Tracks message edits/deletes, voice join/leave,
// and friend add/remove, so you have a record even after Discord's own UI
// stops showing "(edited)"/deleted content.

const MAX_ENTRIES = 500;
const STORAGE_KEY = "abyss-event-logs-entries";

type EventKind = "message-edit" | "message-delete" | "voice-join" | "voice-leave" | "friend-add" | "friend-remove";

interface LogEntry {
    id: string;
    kind: EventKind;
    timestamp: number;
    summary: string;
    detail?: string;
}

const settings = definePluginSettings({
    logMessageEdits: { type: OptionType.BOOLEAN, description: "Log message edits (old content)", default: true },
    logMessageDeletes: { type: OptionType.BOOLEAN, description: "Log message deletes (content)", default: true },
    logVoice: { type: OptionType.BOOLEAN, description: "Log your own voice channel joins/leaves", default: true },
    logFriends: { type: OptionType.BOOLEAN, description: "Log friend adds/removals", default: true },
});

let entries: LogEntry[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        entries = raw ? JSON.parse(raw) : [];
    } catch { entries = []; }
}

function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES))); } catch { }
}

function pushEntry(kind: EventKind, summary: string, detail?: string) {
    entries.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, timestamp: Date.now(), summary, detail });
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    persist();
    notify();
}

function clearLogs() {
    entries = [];
    persist();
    notify();
}

// ── Tracking state ──────────────────────────────────────────────────────────────

const messageCache = new Map<string, string>(); // messageId -> content, for delete/edit-before lookups
let lastVoiceChannelId: string | null = null;

function trackMessageCreate(message: any) {
    if (message?.id && typeof message.content === "string") messageCache.set(message.id, message.content);
}

function trackMessageUpdate(message: any) {
    if (!settings.store.logMessageEdits) return;
    if (!message?.id) return;
    const oldContent = messageCache.get(message.id);
    if (oldContent === undefined || oldContent === message.content) {
        if (typeof message.content === "string") messageCache.set(message.id, message.content);
        return;
    }
    const channel = ChannelStore.getChannel(message.channel_id);
    const author = message.author ? (message.author.globalName || message.author.username) : "Unknown";
    pushEntry("message-edit", `${author} edited a message in ${channel?.name || "a DM"}`, oldContent);
    messageCache.set(message.id, message.content);
}

function trackMessageDelete(data: any) {
    if (!settings.store.logMessageDeletes) return;
    const id = data?.id;
    if (!id) return;
    const content = messageCache.get(id);
    const channel = ChannelStore.getChannel(data.channelId);
    pushEntry("message-delete", `A message was deleted in ${channel?.name || "a DM"}`, content);
    messageCache.delete(id);
}

function trackVoiceStateUpdates({ voiceStates }: { voiceStates: any[]; }) {
    if (!settings.store.logVoice) return;
    const me = UserStore.getCurrentUser();
    if (!me) return;
    const myState = voiceStates.find(s => s.userId === me.id);
    if (!myState) return;

    if (myState.channelId !== lastVoiceChannelId) {
        if (lastVoiceChannelId) {
            const prevChannel = ChannelStore.getChannel(lastVoiceChannelId);
            pushEntry("voice-leave", `Left voice channel "${prevChannel?.name || lastVoiceChannelId}"`);
        }
        if (myState.channelId) {
            const guild = myState.guildId ? GuildStore.getGuild(myState.guildId) : null;
            const channel = ChannelStore.getChannel(myState.channelId);
            pushEntry("voice-join", `Joined voice channel "${channel?.name || myState.channelId}"${guild ? ` in ${guild.name}` : ""}`);
        }
        lastVoiceChannelId = myState.channelId || null;
    }
}

function trackRelationshipAdd(data: any) {
    if (!settings.store.logFriends) return;
    if (data?.relationship?.type !== 1) return;
    const user = UserStore.getUser(data.relationship.id);
    pushEntry("friend-add", `Became friends with ${user?.globalName || user?.username || data.relationship.id}`);
}

function trackRelationshipRemove(data: any) {
    if (!settings.store.logFriends) return;
    const user = UserStore.getUser(data.relationship?.id);
    pushEntry("friend-remove", `Removed friend ${user?.globalName || user?.username || data.relationship?.id}`);
}

// ── UI ─────────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<EventKind, string> = {
    "message-edit": "Message edited",
    "message-delete": "Message deleted",
    "voice-join": "Voice join",
    "voice-leave": "Voice leave",
    "friend-add": "Friend added",
    "friend-remove": "Friend removed",
};
const KIND_COLOR: Record<EventKind, string> = {
    "message-edit": "#f0b232",
    "message-delete": "#ed4245",
    "voice-join": "#3ba55c",
    "voice-leave": "#747f8d",
    "friend-add": "#5865f2",
    "friend-remove": "#ed4245",
};

function EventLogsIcon(props: any) {
    return (
        <svg width={props.width || 20} height={props.height || 20} viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fillOpacity="0" stroke="currentColor" strokeWidth="1.6" />
            <path d="M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.6" />
            <line x1="8" y1="17" x2="16" y2="17" stroke="currentColor" strokeWidth="1.6" />
        </svg>
    );
}

function EventLogsModal({ rootProps }: { rootProps: any; }) {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [filter, setFilter] = React.useState<EventKind | "all">("all");

    React.useEffect(() => {
        listeners.add(forceUpdate);
        return () => { listeners.delete(forceUpdate); };
    }, []);

    const filtered = filter === "all" ? entries : entries.filter(e => e.kind === filter);

    return (
        <ModalRoot {...rootProps} size="large" className="el-modal">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    <EventLogsIcon width={18} height={18} /> Event Logs
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className="el-content">
                <div className="el-filters">
                    {(["all", "message-edit", "message-delete", "voice-join", "voice-leave", "friend-add", "friend-remove"] as const).map(f => (
                        <button key={f} className={`el-filter-btn${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
                            {f === "all" ? "All" : KIND_LABEL[f]}
                        </button>
                    ))}
                    <button className="el-clear-btn" onClick={clearLogs} disabled={entries.length === 0}>Clear all</button>
                </div>
                <div className="el-list">
                    {filtered.length === 0 ? (
                        <div className="el-empty">No events logged yet.</div>
                    ) : filtered.map(e => (
                        <div key={e.id} className="el-entry">
                            <span className="el-entry-badge" style={{ background: KIND_COLOR[e.kind] + "22", color: KIND_COLOR[e.kind] }}>{KIND_LABEL[e.kind]}</span>
                            <div className="el-entry-body">
                                <div className="el-entry-summary">{e.summary}</div>
                                {e.detail && <div className="el-entry-detail">{e.detail}</div>}
                            </div>
                            <span className="el-entry-time">{new Date(e.timestamp).toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function EventLogsButton() {
    return (
        <HeaderBarButton icon={EventLogsIcon} tooltip="Event Logs" onClick={() => openModal(props => <EventLogsModal rootProps={props} />)} />
    );
}

export default definePlugin({
    name: "EventLogs",
    enabledByDefault: false,
    description: "Keeps a local log of message edits/deletes, your own voice channel joins/leaves, and friend adds/removals. Stored only on this device.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["HeaderBarAPI"],
    settings,

    flux: {
        MESSAGE_CREATE(data: any) { trackMessageCreate(data.message); },
        MESSAGE_UPDATE(data: any) { trackMessageUpdate(data.message); },
        MESSAGE_DELETE(data: any) { trackMessageDelete(data); },
        VOICE_STATE_UPDATES: trackVoiceStateUpdates,
        RELATIONSHIP_ADD: trackRelationshipAdd,
        RELATIONSHIP_REMOVE: trackRelationshipRemove,
    },

    start() {
        load();
        addHeaderBarButton("abyss-event-logs", () => <EventLogsButton />, 4);
    },

    stop() {
        removeHeaderBarButton("abyss-event-logs");
        messageCache.clear();
    }
});
