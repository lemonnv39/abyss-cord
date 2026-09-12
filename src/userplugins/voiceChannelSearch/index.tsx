/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addHeaderBarButton, HeaderBarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, Forms, GuildChannelStore, GuildStore, IconUtils, React, ScrollerThin, useEffect, useMemo, useRef, UserStore, useState, VoiceStateStore } from "@webpack/common";

const ChannelActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

interface VoiceChannel {
    channelId: string;
    channelName: string;
    channelType: number;
    guildId: string;
    guildName: string;
    guildIcon: string | null;
    memberCount: number;
    canAccess: boolean;
    searchIndex: string;
    memberIds?: string[];
}

// Une entrée par personne actuellement en vocal, sans plafond — contrairement
// à VoiceChannel.memberIds (limité à 5, juste pour l'aperçu des avatars),
// c'est cette liste complète qui permet à "chercher un utilisateur" de la
// retrouver même dans un gros salon.
interface VoiceMember {
    userId: string;
    channelId: string;
    channelName: string;
    guildId: string;
    guildName: string;
}

interface ScanResult {
    channels: VoiceChannel[];
    voiceMembers: VoiceMember[];
}

let scanCache: ScanResult | null = null;
let scanCacheAt = 0;
const SCAN_TTL = 10000;

async function scan(): Promise<ScanResult> {
    if (scanCache && Date.now() - scanCacheAt < SCAN_TTL) return scanCache;

    return new Promise(resolve => {
        setTimeout(() => {
            try {
                const guilds: any = GuildStore.getGuilds?.() ?? {};

                const memberCount: Record<string, number> = {};
                const memberIds: Record<string, string[]> = {};
                // Construite DIRECTEMENT depuis getAllVoiceStates() + ChannelStore,
                // sans dépendre de la liste `out` construite plus bas via
                // GuildChannelStore.getChannels() — sur une grosse guilde, ce
                // dernier peut ne pas exposer tous les salons vocaux (catégories
                // pas encore chargées côté client), ce qui ferait disparaître
                // silencieusement des gens pourtant bien présents dans les
                // voice states. "Chercher un utilisateur" doit rester fiable
                // même quand la liste de navigation ne l'est pas complètement.
                const voiceMembers: VoiceMember[] = [];
                try {
                    const all: any = VoiceStateStore.getAllVoiceStates?.() ?? {};
                    for (const gId in all) {
                        const gName: string = guilds[gId]?.name ?? "";
                        for (const uId in all[gId]) {
                            const cid = all[gId][uId]?.channelId;
                            if (!cid) continue;
                            memberCount[cid] = (memberCount[cid] ?? 0) + 1;
                            if (!memberIds[cid]) memberIds[cid] = [];
                            if (memberIds[cid].length < 5) memberIds[cid].push(uId);

                            const channel: any = ChannelStore.getChannel?.(cid);
                            voiceMembers.push({
                                userId: uId,
                                channelId: cid,
                                channelName: channel?.name ?? "",
                                guildId: gId,
                                guildName: gName,
                            });
                        }
                    }
                } catch { }

                const out: VoiceChannel[] = [];

                for (const guildId in guilds) {
                    const guild = guilds[guildId];
                    if (!guild) continue;
                    const gName: string = guild.name ?? "";
                    const gIcon: string | null = guild.icon
                        ? IconUtils.getGuildIconURL({ id: guildId, icon: guild.icon, size: 32 }) ?? null
                        : null;

                    const allChannels = GuildChannelStore.getChannels?.(guildId) ?? {};
                    const seen = new Set<string>();
                    for (const key of Object.keys(allChannels)) {
                        const arr = allChannels[key];
                        if (!Array.isArray(arr)) continue;
                        for (const item of arr) {
                            const ch = item?.channel ?? item;
                            if (!ch?.id || seen.has(ch.id)) continue;
                            if (ch.type !== 2 && ch.type !== 13) continue;
                            seen.add(ch.id);
                            const cName: string = ch.name ?? "";
                            out.push({
                                channelId: ch.id,
                                channelName: cName,
                                channelType: ch.type ?? 2,
                                guildId,
                                guildName: gName,
                                guildIcon: gIcon,
                                memberCount: memberCount[ch.id] ?? 0,
                                canAccess: true,
                                searchIndex: `${cName.toLowerCase()} ${gName.toLowerCase()}`,
                                memberIds: memberIds[ch.id] ?? [],
                            });
                        }
                    }
                }

                out.sort((a, b) => b.memberCount - a.memberCount || a.guildName.localeCompare(b.guildName));

                const result: ScanResult = { channels: out, voiceMembers };
                scanCache = result;
                scanCacheAt = Date.now();
                resolve(result);
            } catch { resolve({ channels: [], voiceMembers: [] }); }
        }, 0);
    });
}

function SearchIcon({ width = 20, height = 20 }: { width?: number; height?: number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" clipRule="evenodd" />
        </svg>
    );
}
function VoiceIcon() {
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}><path d="M12 3a1 1 0 0 0-1 1v16a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1ZM8 6a1 1 0 0 0-1 1v10a1 1 0 0 0 2 0V7a1 1 0 0 0-1-1ZM4 9a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1ZM16 6a1 1 0 0 0-1 1v10a1 1 0 0 0 2 0V7a1 1 0 0 0-1-1ZM20 9a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Z" /></svg>;
}
function StageIcon() {
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}><path d="M12 3a1 1 0 0 0-1 1v4.586l-3.293-3.293a1 1 0 0 0-1.414 1.414L9.586 10H5a1 1 0 0 0 0 2h4.586l-3.293 3.293a1 1 0 1 0 1.414 1.414L11 13.414V18a1 1 0 0 0 2 0v-4.586l3.293 3.293a1 1 0 0 0 1.414-1.414L14.414 12H19a1 1 0 0 0 0-2h-4.586l3.293-3.293a1 1 0 0 0-1.414-1.414L13 8.586V4a1 1 0 0 0-1-1Z" /></svg>;
}
function SpinnerIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "vcs-spin 0.8s linear infinite" }}>
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
    );
}

function VoiceSearchModal({ rootProps, channels, voiceMembers }: { rootProps: any; channels: VoiceChannel[] | null; voiceMembers: VoiceMember[]; }) {
    const [query, setQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [userQuery, setUserQuery] = useState("");
    const [debouncedUserQuery, setDebouncedUserQuery] = useState("");
    const [joiningId, setJoiningId] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 80);
        return () => clearTimeout(handle);
    }, [query]);

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedUserQuery(userQuery.trim().toLowerCase()), 80);
        return () => clearTimeout(handle);
    }, [userQuery]);

    const filtered = useMemo(() => {
        if (!channels) return null;
        if (!debouncedQuery) return channels;
        return channels.filter(c => c.searchIndex?.includes(debouncedQuery));
    }, [channels, debouncedQuery]);

    // Ne cherche que parmi les gens ACTUELLEMENT en vocal (voiceMembers) —
    // pas dans tout le cache d'utilisateurs connus du client, qui donnerait
    // des dizaines de résultats sans rapport avec la question posée ("est-ce
    // que cette personne est en vocal là, maintenant"). Accepte aussi bien un
    // pseudo/nom d'affichage qu'un ID Discord brut (pratique quand deux
    // personnes ont un pseudo proche, ou pour viser quelqu'un sans ambiguïté).
    const matchedUsers = useMemo(() => {
        if (!debouncedUserQuery) return [];
        const seen = new Set<string>();
        const results: Array<VoiceMember & { displayName: string; avatarUrl: string; }> = [];
        for (const m of voiceMembers) {
            const user = UserStore.getUser(m.userId);
            if (!user) continue;
            const displayName = user.globalName || user.username;
            const nameMatches = displayName?.toLowerCase().includes(debouncedUserQuery) || user.username?.toLowerCase().includes(debouncedUserQuery);
            const idMatches = m.userId.includes(debouncedUserQuery);
            if (!nameMatches && !idMatches) continue;
            seen.add(m.userId);
            results.push({ ...m, displayName, avatarUrl: user.getAvatarURL(m.guildId, 32) });
        }

        // Filet de sécurité pour un ID complet : passe directement par
        // VoiceStateStore.getVoiceStateForUser() plutôt que par le scan
        // périodique ci-dessus — ce dernier a un TTL de 10s et dépend d'une
        // itération manuelle des guildes/salons, donc un ID collé juste après
        // qu'un ami ait rejoint un vocal pourrait rater le scan en cache.
        if (/^\d{15,25}$/.test(debouncedUserQuery) && !seen.has(debouncedUserQuery)) {
            const vs: any = VoiceStateStore.getVoiceStateForUser?.(debouncedUserQuery);
            if (vs?.channelId) {
                const user = UserStore.getUser(debouncedUserQuery);
                const channel: any = ChannelStore.getChannel?.(vs.channelId);
                const guildId: string = vs.guildId ?? channel?.guild_id ?? "";
                const guild: any = GuildStore.getGuild?.(guildId);
                if (user) {
                    results.push({
                        userId: debouncedUserQuery,
                        channelId: vs.channelId,
                        channelName: channel?.name ?? "",
                        guildId,
                        guildName: guild?.name ?? "",
                        displayName: user.globalName || user.username,
                        avatarUrl: user.getAvatarURL(guildId, 32),
                    });
                }
            }
        }

        return results;
    }, [voiceMembers, debouncedUserQuery]);

    function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
        setQuery(e.target.value);
    }

    function handleUserQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
        setUserQuery(e.target.value);
    }

    async function join(channelId: string) {
        if (joiningId) return;
        setJoiningId(channelId);
        try {
            ChannelActions.selectVoiceChannel(channelId);
            await new Promise(r => setTimeout(r, 400));
        } catch { }
        setJoiningId(null);
        rootProps.onClose();
    }

    const displayList = filtered ?? channels;
    const count = displayList?.length ?? 0;

    return (
        <ModalRoot {...rootProps} size="medium" className="vcs-root">
            <ModalHeader separator={false} className="vcs-header">
                <div className="vcs-header-icon"><SearchIcon width={20} height={20} /></div>
                <div className="vcs-header-text">
                    <Forms.FormTitle tag="h4" className="vcs-title">
                        Voice Channels
                        {displayList !== null && <span className="vcs-count-badge">{count}</span>}
                    </Forms.FormTitle>
                    <Forms.FormText className="vcs-subtitle">Cherche et rejoins n'importe quel salon vocal de tes serveurs.</Forms.FormText>
                </div>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent className="vcs-content">
                {channels === null ? (
                    <div className="vcs-loading">
                        <SpinnerIcon />
                        <span>Loading channels...</span>
                    </div>
                ) : (
                    <>
                        <div className="vcs-search-bar">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
                                <path d="M21.71 20.29l-5.01-5.01A7.94 7.94 0 0 0 18 10a8 8 0 1 0-8 8 7.94 7.94 0 0 0 5.28-1.3l5.01 5.01a1 1 0 0 0 1.42-1.42ZM4 10a6 6 0 1 1 6 6 6 6 0 0 1-6-6Z" />
                            </svg>
                            <input
                                ref={inputRef}
                                autoFocus
                                className="vcs-search-input"
                                placeholder="Channel or server..."
                                value={query}
                                onChange={handleQueryChange}
                            />
                            {query && (
                                <button className="vcs-search-clear" onClick={() => { setQuery(""); setDebouncedQuery(""); }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                                </button>
                            )}
                        </div>
                        <div className="vcs-search-bar">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
                                <path d="M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4Zm0-2a4 4 0 1 1 4-4 4 4 0 0 1-4 4Z" />
                            </svg>
                            <input
                                className="vcs-search-input"
                                placeholder="Search a user (name or ID)..."
                                value={userQuery}
                                onChange={handleUserQueryChange}
                            />
                            {userQuery && (
                                <button className="vcs-search-clear" onClick={() => { setUserQuery(""); setDebouncedUserQuery(""); }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                                </button>
                            )}
                        </div>
                        {debouncedUserQuery && (
                            <div className="vcs-user-results">
                                {matchedUsers.length === 0 ? (
                                    <div className="vcs-empty">Not in a shared voice channel right now</div>
                                ) : matchedUsers.slice(0, 30).map(m => (
                                    <div key={m.userId}
                                        className="vcs-row"
                                        onClick={() => join(m.channelId)}
                                    >
                                        <img src={m.avatarUrl} className="vcs-user-avatar" alt="" loading="lazy" />
                                        <div className="vcs-info">
                                            <span className="vcs-name">{m.displayName}</span>
                                            <div className="vcs-guild">
                                                <span className="vcs-guild-name">{m.channelName} · {m.guildName}</span>
                                            </div>
                                        </div>
                                        {joiningId === m.channelId
                                            ? <span className="vcs-joining-label">Joining...</span>
                                            : <button className="vcs-join-btn" onClick={e => { e.stopPropagation(); join(m.channelId); }}>Join</button>
                                        }
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="vcs-card">
                            <ScrollerThin fade className="vcs-channel-list">
                                {displayList!.length === 0 && (
                                    <div className="vcs-empty">{query ? "No channel found" : "No voice channels"}</div>
                                )}
                                {displayList!.slice(0, 150).map(ch => (
                                    <div key={ch.channelId}
                                        className={`vcs-row${ch.canAccess ? "" : " vcs-row--locked"}`}
                                        onClick={() => ch.canAccess && join(ch.channelId)}
                                        title={ch.canAccess ? undefined : "No permission to join this channel"}
                                    >
                                        <span className="vcs-icon">
                                            {ch.canAccess
                                                ? (ch.channelType === 13 ? <StageIcon /> : <VoiceIcon />)
                                                : <span style={{ opacity: 0.5, fontSize: 13 }}>🔒</span>
                                            }
                                        </span>
                                        <div className="vcs-info">
                                            <span className="vcs-name">{ch.channelName}</span>
                                            <div className="vcs-guild">
                                                {ch.guildIcon && <img src={ch.guildIcon} className="vcs-guild-icon" alt="" loading="lazy" />}
                                                <span className="vcs-guild-name">{ch.guildName}</span>
                                                {ch.memberCount > 0 && (
                                                    <div className="vcs-members-info">
                                                        <span className="vcs-members-count"> · {ch.memberCount}</span>
                                                        <div className="vcs-member-avatars">
                                                            {ch.memberIds?.map((uId: string) => {
                                                                const user = UserStore.getUser(uId);
                                                                if (!user) return null;
                                                                const avatarUrl = user.getAvatarURL(ch.guildId, 16);
                                                                return <img key={uId} src={avatarUrl} className="vcs-member-avatar" />;
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {joiningId === ch.channelId
                                            ? <span className="vcs-joining-label">Joining...</span>
                                            : ch.canAccess
                                                ? <button className="vcs-join-btn" onClick={e => { e.stopPropagation(); join(ch.channelId); }}>Join</button>
                                                : <span className="vcs-locked-label">Private</span>
                                        }
                                    </div>
                                ))}
                                {displayList!.length > 80 && !query && (
                                    <div className="vcs-empty" style={{ fontSize: 11, opacity: 0.5 }}>
                                        {displayList!.length - 80} more channels — use search
                                    </div>
                                )}
                            </ScrollerThin>
                        </div>
                    </>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

function VoiceSearchModalWrapper({ rootProps }: { rootProps: any; }) {
    const initial = scanCache && Date.now() - scanCacheAt < SCAN_TTL ? scanCache : null;
    const [channels, setChannels] = useState<VoiceChannel[] | null>(initial?.channels ?? null);
    const [voiceMembers, setVoiceMembers] = useState<VoiceMember[]>(initial?.voiceMembers ?? []);

    useEffect(() => {
        if (channels !== null) return;
        scan().then(result => {
            setChannels(result.channels);
            setVoiceMembers(result.voiceMembers);
        });
    }, []);

    return <VoiceSearchModal rootProps={rootProps} channels={channels} voiceMembers={voiceMembers} />;
}

function VCSHeaderButton() {
    return (
        <HeaderBarButton
            icon={SearchIcon}
            tooltip="Search voice channel"
            onClick={() => openModal(props => <VoiceSearchModalWrapper rootProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "VoiceChannelSearch",
    enabledByDefault: false,
    description: "Search and join any voice channel across all your servers, or search a user by name to see which voice channel they're currently in on any server you share with them.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["HeaderBarAPI"],

    start() {
        addHeaderBarButton("abyss-voice-channel-search", () => <VCSHeaderButton />, 9);
    },
    stop() {
        removeHeaderBarButton("abyss-voice-channel-search");
        scanCache = null;
    },
});
