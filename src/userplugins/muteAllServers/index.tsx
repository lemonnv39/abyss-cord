/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Mécanisme de mute porté de Nightcord (nightcordplugins/muteAllServers) :
 * même payload de notification-settings (mute permanent + suppress
 * everyone/roles + push mobile coupé) et même ack "marquer comme lu" par
 * serveur. L'UI, elle, reprend le patron déjà établi ici par LeaveAllServers
 * (modal avec liste cochable/recherche) plutôt que le simple item de menu
 * de Nightcord — plus cohérent avec le reste du repo, et ça laisse le choix
 * des serveurs plutôt qu'un "tout ou rien" à l'aveugle.
 */

import "./styles.css";

import { addContextMenuPatch, findGroupChildrenByChildId, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Forms, GuildStore, IconUtils, Menu, RestAPI, showToast, Toasts, useEffect, useMemo, useState } from "@webpack/common";

interface GuildEntry {
    id: string;
    name: string;
    icon: string | null;
}

// Payload identique à celui de Nightcord : mute_config.selected_time_window
// -1 = mute permanent (les autres valeurs Discord sont des minutes : 15/60/
// 480/1440). suppress_everyone/suppress_roles coupent aussi les mentions
// @everyone/@here et de rôle, pas juste les messages normaux.
const MUTE_PAYLOAD = {
    muted: true,
    mute_config: { selected_time_window: -1, end_time: null },
    suppress_everyone: true,
    suppress_roles: true,
    message_notifications: 2,
    mobile_push: false,
};

// Endpoint REST officiel de Discord plutôt qu'un module webpack interne —
// même choix que LeaveAllServers, plus résistant aux updates Discord.
function muteGuild(id: string): Promise<any> {
    return RestAPI.patch({ url: `/users/@me/guilds/${id}/settings`, body: MUTE_PAYLOAD });
}

function ackGuild(id: string): Promise<any> {
    return RestAPI.post({ url: `/guilds/${id}/ack`, body: {} }).catch(() => { });
}

function SearchIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
            <path d="M21.71 20.29l-5.01-5.01A7.94 7.94 0 0 0 18 10a8 8 0 1 0-8 8 7.94 7.94 0 0 0 5.28-1.3l5.01 5.01a1 1 0 0 0 1.42-1.42ZM4 10a6 6 0 1 1 6 6 6 6 0 0 1-6-6Z" />
        </svg>
    );
}

function MuteAllServersModal({ rootProps }: { rootProps: any; }) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
    const [progress, setProgress] = useState("");
    const [currentIdx, setCurrentIdx] = useState(0);

    const allGuilds = useMemo<GuildEntry[]>(() => {
        const raw = GuildStore?.getGuilds?.() ?? {};
        return (Object.values(raw) as GuildEntry[]).sort((a, b) => a.name.localeCompare(b.name));
    }, []);

    useEffect(() => {
        setSelected(new Set(allGuilds.map(g => g.id)));
    }, [allGuilds]);

    const filtered = useMemo(() => {
        if (!search.trim()) return allGuilds;
        const q = search.toLowerCase();
        return allGuilds.filter(g => g.name.toLowerCase().includes(q));
    }, [allGuilds, search]);

    const toggleGuild = (id: string) => {
        if (status === "running") return;
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const selectAll = () => setSelected(new Set(allGuilds.map(g => g.id)));
    const selectNone = () => setSelected(new Set());

    const handleMute = async () => {
        if (selected.size === 0) return;
        setStatus("running");
        const ids = Array.from(selected);
        let count = 0;

        for (let i = 0; i < ids.length; i++) {
            const guild = GuildStore.getGuild(ids[i]);
            if (!guild) continue;
            setCurrentIdx(i + 1);
            setProgress(`[${i + 1}/${ids.length}] Muting: ${guild.name}...`);
            try {
                await muteGuild(ids[i]);
                await ackGuild(ids[i]);
                count++;
            } catch (e) {
                console.error(`[MuteAllServers] Failed to mute ${guild.name}:`, e);
            }
            await new Promise(r => setTimeout(r, 500));
        }

        setStatus("done");
        setProgress(`${count} server${count > 1 ? "s" : ""} muted and marked as read`);
        showToast(`${count} servers muted and marked as read!`, Toasts.Type.SUCCESS);
    };

    function getGuildIcon(g: GuildEntry) {
        if (g.icon) return IconUtils?.getGuildIconURL({ id: g.id, icon: g.icon, size: 64 });
        return null;
    }

    const pct = selected.size > 0 && status === "running"
        ? Math.round((currentIdx / selected.size) * 100) : 0;

    return (
        <ModalRoot {...rootProps} size="medium">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, color: "#fff" }}>
                    Mute All Servers
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>

            <ModalContent className="mas-content">
                <div className="mas-search-bar">
                    <SearchIcon />
                    <input
                        className="mas-search-input"
                        type="text"
                        placeholder="Search a server..."
                        value={search}
                        onChange={e => setSearch(e.currentTarget.value)}
                        autoFocus
                    />
                    {search && (
                        <button className="mas-search-clear" onClick={() => setSearch("")}>✕</button>
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Forms.FormTitle tag="h5" className="mas-label">SELECT SERVERS</Forms.FormTitle>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button className="mas-mini-btn" onClick={selectAll} disabled={status === "running"}>All</button>
                        <button className="mas-mini-btn" onClick={selectNone} disabled={status === "running"}>None</button>
                    </div>
                </div>

                <div className="mas-guild-list">
                    {filtered.length === 0 && (
                        <div className="mas-empty">
                            {search ? `No results for "${search}"` : "No servers found"}
                        </div>
                    )}
                    {filtered.map(g => {
                        const av = getGuildIcon(g);
                        const isSel = selected.has(g.id);
                        return (
                            <div
                                key={g.id}
                                className={`mas-guild-row ${isSel ? "mas-guild-row--selected" : ""}`}
                                onClick={() => toggleGuild(g.id)}
                            >
                                {av
                                    ? <img src={av} className="mas-avatar" alt="" />
                                    : <div className="mas-avatar-placeholder">{g.name.replace(/\s+/g, "").slice(0, 2).toUpperCase()}</div>
                                }
                                <span className="mas-guild-name">{g.name}</span>
                                {isSel && <span className="mas-check">✓</span>}
                            </div>
                        );
                    })}
                </div>

                {status !== "idle" && (
                    <div className={`mas-status mas-status--${status}`}>{progress}</div>
                )}

                <div className="mas-footer-info">
                    <span>{selected.size} servers selected</span>
                </div>

                <button
                    className="mas-mute-btn"
                    onClick={handleMute}
                    disabled={selected.size === 0 || status === "running"}
                >
                    {status === "running"
                        ? `In progress... (${pct}%)`
                        : `Mute ${selected.size} servers`}
                </button>
            </ModalContent>
        </ModalRoot>
    );
}

const patchGuildContext: NavContextMenuPatchCallback = (children, { guild }) => {
    if (!children || !Array.isArray(children)) return;
    try {
        if (!guild) return;

        const group = findGroupChildrenByChildId("mute-guild", children) ?? children;
        const item = (
            <Menu.MenuItem
                id="mute-all-servers"
                key="mute-all-servers"
                label="Mute All Servers"
                action={() => openModal(props => <MuteAllServersModal rootProps={props} />)}
            />
        );

        if (Array.isArray(group)) {
            const idx = group.findIndex((c: any) => c?.props?.id === "mute-guild");
            if (idx >= 0) {
                group.splice(idx + 1, 0, item);
            } else {
                group.push(item);
            }
        }
    } catch (e) {
        console.error("[MuteAllServers] Context menu patch error:", e);
    }
};

export default definePlugin({
    name: "MuteAllServers",
    enabledByDefault: false,
    description: "Mute multiple servers at once (permanently, including @everyone/role mentions) and mark them as read, from a searchable checklist. Accessible via right-click on a server.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["ContextMenuAPI"],

    start() {
        addContextMenuPatch("guild-context", patchGuildContext);
    },

    stop() {
        removeContextMenuPatch("guild-context", patchGuildContext);
    }
});
