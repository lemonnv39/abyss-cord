/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Cleaner — remet un compte à un état proche de l'origine en une seule
 * passe orchestrée : restauration du profil, nettoyage des messages en MP,
 * fermeture des MP, sortie des groupes, sortie des serveurs, suppression
 * des amis. Chaque section est indépendamment activable, avec des listes
 * "à garder" (tout coché par défaut = sera supprimé, décoche ce que tu
 * gardes) pour serveurs et amis.
 *
 * Ordre d'exécution volontaire : profil (instantané, 1 requête) → messages
 * → fermeture MP → groupes → serveurs → amis. Les messages sont nettoyés
 * AVANT de fermer les MP/quitter les groupes, sinon plus moyen d'y accéder
 * une fois sorti/fermé.
 *
 * Tout passe par les endpoints REST officiels de Discord (les mêmes que le
 * client utilise lui-même), avec un délai de 800ms entre chaque action et
 * un retry automatique avec backoff sur les 429 — même philosophie que
 * LeaveAllServers/ClearFriends/MessageCleaner déjà dans ce repo, mais
 * généralisée ici à toutes les catégories d'action (ces plugins-là ne
 * retry pas les 429 individuellement, celui-ci si).
 *
 * Ce plugin ne modifie ni ne supprime LeaveAllServers/ClearFriends/
 * MessageCleaner — il duplique la logique nécessaire dans son propre
 * dossier, en plugin totalement autonome (convention du repo : un plugin
 * = un dossier isolé).
 */

import "./styles.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, Forms, GuildStore, React, RelationshipStore, RestAPI, showToast, Toasts, UserStore, useEffect, useMemo, useState } from "@webpack/common";

const RelationshipStoreLazy = findStoreLazy("RelationshipStore");
const UserStoreLazy = findStoreLazy("UserStore");

// ── Constantes ───────────────────────────────────────────────────────────────

const ACTION_DELAY_MS = 800;

// ── REST avec retry automatique sur 429 ────────────────────────────────────────
// Généralisé à toutes les catégories d'action de ce plugin (contrairement à
// LeaveAllServers/ClearFriends qui n'ont pas ce retry) — l'ampleur de ce que
// fait Cleaner en une seule passe justifie une robustesse supplémentaire.
async function requestWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    try {
        return await fn();
    } catch (e: any) {
        const status = e?.status ?? e?.statusCode;
        if (status === 429 && retries > 0) {
            const retryAfter = e?.body?.retry_after ?? 5;
            await sleep(retryAfter * 1000);
            return requestWithRetry(fn, retries - 1);
        }
        throw e;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Endpoints officiels ─────────────────────────────────────────────────────
function leaveGuild(id: string): Promise<any> {
    return requestWithRetry(() => RestAPI.del({ url: `/users/@me/guilds/${id}` }));
}
function removeFriend(id: string): Promise<any> {
    return requestWithRetry(() => RestAPI.del({ url: `/users/@me/relationships/${id}` }));
}
// Même endpoint pour fermer un DM et quitter un groupe — DELETE /channels/:id
// "ferme" une conversation 1-à-1 pour toi (pas supprimée pour l'autre) et
// "quitte" un DM de groupe (te retire de la liste des destinataires).
function closeOrLeaveChannel(id: string): Promise<any> {
    return requestWithRetry(() => RestAPI.del({ url: `/channels/${id}` }));
}

function isCallMessage(message: any): boolean {
    return message?.type === 3 || !!message?.call;
}
function canDeleteMessage(message: any, currentUserId: string): boolean {
    if (message?.author?.id !== currentUserId) return false;
    return message.type === 0 || message.type === 19 || isCallMessage(message);
}
async function deleteMessage(channelId: string, messageId: string): Promise<boolean> {
    try {
        await requestWithRetry(() => RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` }));
        return true;
    } catch {
        return false;
    }
}
// Les messages d'appel (type 3) ne se suppriment pas toujours avec un DELETE
// simple — poster un message jetable donne un contexte de suppression frais,
// puis on supprime les deux (technique déjà validée dans MessageCleaner).
async function silentDeleteMessage(channelId: string, messageId: string): Promise<boolean> {
    try {
        const response = await requestWithRetry(() => RestAPI.post({
            url: `/channels/${channelId}/messages`,
            body: { content: "** **", flags: 4096, nonce: messageId, tts: false },
        }));
        await sleep(150);
        if (response?.body?.id) {
            await RestAPI.del({ url: `/channels/${channelId}/messages/${response.body.id}` }).catch(() => { });
        }
        await sleep(100);
        await RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` }).catch(() => { });
        return true;
    } catch {
        return deleteMessage(channelId, messageId);
    }
}
async function deleteTargetMessage(channelId: string, message: any): Promise<boolean> {
    return isCallMessage(message) ? silentDeleteMessage(channelId, message.id) : deleteMessage(channelId, message.id);
}
async function getChannelMessages(channelId: string, before?: string): Promise<any[]> {
    try {
        const url = before ? `/channels/${channelId}/messages?limit=100&before=${before}` : `/channels/${channelId}/messages?limit=100`;
        const response = await RestAPI.get({ url });
        return Array.isArray(response?.body) ? response.body : [];
    } catch {
        return [];
    }
}

// ── État partagé (hors React, comme MessageCleaner) ───────────────────────────

interface RunStatus {
    label: string;
    detail: string;
    percentage: number;
}

let isRunning = false;
let shouldStop = false;
let runStatus: RunStatus | null = null;
const listeners = new Set<() => void>();
function emit() { listeners.forEach(l => l()); }

function setStatus(label: string, detail: string, percentage: number) {
    runStatus = { label, detail, percentage };
    emit();
}

// ── Étapes individuelles ──────────────────────────────────────────────────────

interface ProfileResetOptions {
    resetAvatar: boolean;
    resetBanner: boolean;
    resetBio: boolean;
    resetPronouns: boolean;
    resetDisplayName: boolean;
}

// Restauration "à l'état d'origine" : avatar par défaut lié à l'ID du compte
// (comme un compte flambant neuf, pas de couleur choisie), bannière et
// couleur de profil retirées (accent_color à null retombe sur le fond noir
// par défaut de Discord), bio/pronoms/pseudo vidés. Un seul PATCH pour tout :
// plus aucun champ ici n'est conditionné au type de Nitro (contrairement à
// une tentative précédente d'appliquer une bannière/couleur choisie, qui se
// heurtait à des 400 "Corps de formulaire non valide" selon les comptes) donc
// plus besoin de séparer les requêtes par groupe de champs.
async function stepResetProfile(opts: ProfileResetOptions) {
    setStatus("Profil", "Restauration en cours...", 0);

    const basics: Record<string, any> = {};
    if (opts.resetAvatar) basics.avatar = null;
    if (opts.resetBanner) {
        basics.banner = null;
        basics.accent_color = null;
    }
    if (opts.resetBio) basics.bio = "";
    if (opts.resetPronouns) basics.pronouns = "";
    if (opts.resetDisplayName) basics.global_name = null;

    let failed = false;
    if (Object.keys(basics).length > 0) {
        try {
            await requestWithRetry(() => RestAPI.patch({ url: "/users/@me", body: basics }));
        } catch (e: any) {
            failed = true;
            console.error("[Cleaner] Profile reset failed:", e?.status ?? e?.statusCode, JSON.stringify(e?.body ?? e?.message ?? e, null, 2));
        }
    }

    if (failed) {
        showToast("Restauration du profil : échec (voir console)", Toasts.Type.FAILURE);
    }
    setStatus("Profil", "Terminé", 100);
}

async function cleanChannelMessages(channelId: string, currentUserId: string, onProgress: (deleted: number, total: number) => void) {
    let lastMessageId: string | undefined;
    let deleted = 0;
    let initialTotal = 0;

    try {
        const res = await RestAPI.get({ url: `/channels/${channelId}/messages/search?author_id=${currentUserId}` });
        if (res?.body?.total_results) initialTotal = res.body.total_results;
    } catch { /* la recherche peut échouer sur certains DMs — pas bloquant */ }

    while (!shouldStop) {
        const messages = await getChannelMessages(channelId, lastMessageId);
        if (messages.length === 0) break;

        const mine = messages.filter(m => canDeleteMessage(m, currentUserId));
        for (const message of mine) {
            if (shouldStop) break;
            if (await deleteTargetMessage(channelId, message)) deleted++;
            onProgress(deleted, Math.max(initialTotal, deleted));
            await sleep(ACTION_DELAY_MS);
        }

        lastMessageId = messages[messages.length - 1].id;
        if (messages.length < 100) break;
    }
}

async function stepCleanMessages(channels: { id: string; name: string; }[]) {
    const currentUserId = UserStoreLazy.getCurrentUser()?.id;
    if (!currentUserId) return;

    for (let i = 0; i < channels.length; i++) {
        if (shouldStop) break;
        const ch = channels[i];
        setStatus("Messages", `${ch.name} (${i + 1}/${channels.length})`, Math.round((i / channels.length) * 100));
        await cleanChannelMessages(ch.id, currentUserId, (deleted, total) => {
            setStatus("Messages", `${ch.name} — ${deleted}${total > 0 ? `/${total}` : ""} supprimé(s)`, Math.round((i / channels.length) * 100));
        });
    }
    setStatus("Messages", "Terminé", 100);
}

async function stepCloseChannels(channels: { id: string; name: string; }[], label: string) {
    for (let i = 0; i < channels.length; i++) {
        if (shouldStop) break;
        const ch = channels[i];
        setStatus(label, `${ch.name} (${i + 1}/${channels.length})`, Math.round((i / channels.length) * 100));
        await closeOrLeaveChannel(ch.id).catch(e => console.error(`[Cleaner] ${label} failed for`, ch.id, e));
        await sleep(ACTION_DELAY_MS);
    }
    setStatus(label, "Terminé", 100);
}

async function stepLeaveServers(guilds: { id: string; name: string; }[]) {
    for (let i = 0; i < guilds.length; i++) {
        if (shouldStop) break;
        const g = guilds[i];
        setStatus("Serveurs", `${g.name} (${i + 1}/${guilds.length})`, Math.round((i / guilds.length) * 100));
        await leaveGuild(g.id).catch(e => console.error("[Cleaner] Leave guild failed for", g.id, e));
        await sleep(ACTION_DELAY_MS);
    }
    setStatus("Serveurs", "Terminé", 100);
}

async function stepRemoveFriends(friends: { id: string; name: string; }[]) {
    for (let i = 0; i < friends.length; i++) {
        if (shouldStop) break;
        const f = friends[i];
        setStatus("Amis", `${f.name} (${i + 1}/${friends.length})`, Math.round((i / friends.length) * 100));
        await removeFriend(f.id).catch(e => console.error("[Cleaner] Remove friend failed for", f.id, e));
        await sleep(ACTION_DELAY_MS);
    }
    setStatus("Amis", "Terminé", 100);
}

// ── Orchestrateur ─────────────────────────────────────────────────────────────

interface CleanerPlan {
    resetProfile: ProfileResetOptions | null;
    cleanMessages: { id: string; name: string; }[] | null;
    closeDMs: { id: string; name: string; }[] | null;
    leaveGroups: { id: string; name: string; }[] | null;
    leaveServers: { id: string; name: string; }[] | null;
    removeFriends: { id: string; name: string; }[] | null;
}

async function runPlan(plan: CleanerPlan) {
    isRunning = true;
    shouldStop = false;
    emit();

    try {
        if (plan.resetProfile) await stepResetProfile(plan.resetProfile);
        if (!shouldStop && plan.cleanMessages?.length) await stepCleanMessages(plan.cleanMessages);
        if (!shouldStop && plan.closeDMs?.length) await stepCloseChannels(plan.closeDMs, "Fermeture des MP");
        if (!shouldStop && plan.leaveGroups?.length) await stepCloseChannels(plan.leaveGroups, "Groupes");
        if (!shouldStop && plan.leaveServers?.length) await stepLeaveServers(plan.leaveServers);
        if (!shouldStop && plan.removeFriends?.length) await stepRemoveFriends(plan.removeFriends);
    } finally {
        isRunning = false;
        setStatus(shouldStop ? "Arrêté" : "Terminé", shouldStop ? "Nettoyage interrompu" : "Nettoyage terminé avec succès", 100);
        showToast(shouldStop ? "Nettoyage arrêté" : "Nettoyage terminé !", shouldStop ? Toasts.Type.MESSAGE : Toasts.Type.SUCCESS);
    }
}

function stopRun() {
    shouldStop = true;
}

// ── Icônes ────────────────────────────────────────────────────────────────────

// Balai — volontairement distinct de l'icône poubelle de MessageCleaner
// (déjà présente dans la même barre), pour que les deux ne se confondent pas.
function CleanerIcon({ width = 20, height = 20 }: { width?: number; height?: number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill="currentColor" d="M14.7 2.29a1 1 0 0 1 1.41 0l1.6 1.6a1 1 0 0 1 0 1.42l-6.2 6.2 1.6 1.6-1.42 1.4-1.6-1.59-2.4 2.4a1 1 0 0 1-.33.22l-6 2.4a1 1 0 0 1-1.3-1.3l2.4-6a1 1 0 0 1 .22-.33l11.92-11.92ZM8.9 12.32l-2.02 2.02-1.55 3.88 3.88-1.55 2.02-2.02-2.33-2.33Z" />
        </svg>
    );
}
function SearchIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
            <path d="M21.71 20.29l-5.01-5.01A7.94 7.94 0 0 0 18 10a8 8 0 1 0-8 8 7.94 7.94 0 0 0 5.28-1.3l5.01 5.01a1 1 0 0 0 1.42-1.42ZM4 10a6 6 0 1 1 6 6 6 6 0 0 1-6-6Z" />
        </svg>
    );
}

// ── UI : composants réutilisables ──────────────────────────────────────────────

function useForceUpdate() {
    const [, setTick] = useState(0);
    return () => setTick(t => t + 1);
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void; }) {
    return (
        <button className={`cln-switch ${checked ? "cln-switch--on" : ""}`} onClick={() => onChange(!checked)} type="button">
            <span className="cln-switch-knob" />
        </button>
    );
}

interface PickableEntry { id: string; name: string; icon?: string | null; }

function PickableList({ entries, kept, onToggleKeep, placeholder }: {
    entries: PickableEntry[];
    kept: Set<string>;
    onToggleKeep(id: string): void;
    placeholder: string;
}) {
    const [search, setSearch] = useState("");
    const filtered = useMemo(
        () => entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase())),
        [entries, search]
    );
    const willRemoveCount = entries.length - kept.size;

    return (
        <div className="cln-picker">
            <div className="cln-picker-search">
                <SearchIcon />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={placeholder} />
            </div>
            <div className="cln-picker-list">
                {filtered.length === 0 && <div className="cln-empty">Rien à afficher</div>}
                {filtered.map(e => {
                    const isKept = kept.has(e.id);
                    return (
                        <div key={e.id} className={`cln-picker-row ${isKept ? "cln-picker-row--kept" : ""}`} onClick={() => onToggleKeep(e.id)}>
                            {e.icon
                                ? <img src={e.icon} className="cln-picker-avatar" alt="" onError={ev => (ev.currentTarget.style.visibility = "hidden")} />
                                : <div className="cln-picker-avatar cln-picker-avatar--placeholder">{e.name.slice(0, 2).toUpperCase()}</div>
                            }
                            <span className="cln-picker-name">{e.name}</span>
                            <span className="cln-picker-tag">{isKept ? "Conservé" : "Sera supprimé"}</span>
                        </div>
                    );
                })}
            </div>
            <div className="cln-picker-footer">{willRemoveCount} / {entries.length} seront traités</div>
        </div>
    );
}

// ── Sections du panneau ────────────────────────────────────────────────────────

function ProfileSection({ enabled, onEnabledChange, options, onOptionsChange }: {
    enabled: boolean;
    onEnabledChange(v: boolean): void;
    options: ProfileResetOptions;
    onOptionsChange(o: ProfileResetOptions): void;
}) {
    return (
        <div className="cln-card">
            <div className="cln-card-header">
                <div>
                    <div className="cln-card-title">Restaurer le profil</div>
                    <div className="cln-card-subtitle">Avatar par défaut, bannière, couleur de profil, bio, pronoms et pseudo d'affichage.</div>
                </div>
                <Toggle checked={enabled} onChange={onEnabledChange} />
            </div>
            {enabled && (
                <div className="cln-card-body">
                    <div className="cln-checkrow-group">
                        {([
                            ["resetAvatar", "Réinitialiser l'avatar (par défaut, lié à l'ID du compte)"],
                            ["resetBanner", "Retirer la bannière et la couleur de profil"],
                            ["resetBio", "Vider la bio"],
                            ["resetPronouns", "Vider les pronoms"],
                            ["resetDisplayName", "Réinitialiser le pseudo d'affichage"],
                        ] as [keyof ProfileResetOptions, string][]).map(([key, label]) => (
                            <label key={key} className="cln-checkrow">
                                <input
                                    type="checkbox"
                                    checked={options[key] as boolean}
                                    onChange={e => onOptionsChange({ ...options, [key]: e.target.checked })}
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function SimpleToggleSection({ title, subtitle, enabled, onEnabledChange, count }: {
    title: string;
    subtitle: string;
    enabled: boolean;
    onEnabledChange(v: boolean): void;
    count: number;
}) {
    return (
        <div className="cln-card">
            <div className="cln-card-header">
                <div>
                    <div className="cln-card-title">{title}</div>
                    <div className="cln-card-subtitle">{subtitle} · {count} concerné{count > 1 ? "s" : ""}</div>
                </div>
                <Toggle checked={enabled} onChange={onEnabledChange} />
            </div>
        </div>
    );
}

function PickableSection({ title, subtitle, enabled, onEnabledChange, entries, kept, onToggleKeep, placeholder }: {
    title: string;
    subtitle: string;
    enabled: boolean;
    onEnabledChange(v: boolean): void;
    entries: PickableEntry[];
    kept: Set<string>;
    onToggleKeep(id: string): void;
    placeholder: string;
}) {
    return (
        <div className="cln-card">
            <div className="cln-card-header">
                <div>
                    <div className="cln-card-title">{title}</div>
                    <div className="cln-card-subtitle">{subtitle} · {entries.length} au total</div>
                </div>
                <Toggle checked={enabled} onChange={onEnabledChange} />
            </div>
            {enabled && (
                <div className="cln-card-body">
                    <PickableList entries={entries} kept={kept} onToggleKeep={onToggleKeep} placeholder={placeholder} />
                </div>
            )}
        </div>
    );
}

// ── Modal principale ────────────────────────────────────────────────────────────

function CleanerModal({ rootProps }: { rootProps: any; }) {
    const forceUpdate = useForceUpdate();
    useEffect(() => {
        listeners.add(forceUpdate);
        return () => { listeners.delete(forceUpdate); };
    }, []);

    const [profileEnabled, setProfileEnabled] = useState(false);
    const [profileOptions, setProfileOptions] = useState<ProfileResetOptions>({
        resetAvatar: true,
        resetBanner: true,
        resetBio: true,
        resetPronouns: true,
        resetDisplayName: true,
    });

    const [messagesEnabled, setMessagesEnabled] = useState(false);
    const [closeDMsEnabled, setCloseDMsEnabled] = useState(false);
    const [leaveGroupsEnabled, setLeaveGroupsEnabled] = useState(false);
    const [serversEnabled, setServersEnabled] = useState(false);
    const [friendsEnabled, setFriendsEnabled] = useState(false);

    const [keptServers, setKeptServers] = useState<Set<string>>(new Set());
    const [keptFriends, setKeptFriends] = useState<Set<string>>(new Set());

    const [confirmArmed, setConfirmArmed] = useState(false);

    const dmChannels = useMemo<PickableEntry[]>(() => {
        try {
            const all = Object.values(ChannelStore.getMutablePrivateChannels()) as any[];
            return all.filter(c => c.type === 1).map(c => {
                const user = c.recipients?.[0] ? UserStoreLazy.getUser(c.recipients[0]) : null;
                return { id: c.id, name: user?.globalName || user?.username || "DM inconnu" };
            });
        } catch { return []; }
    }, []);

    const groupChannels = useMemo<PickableEntry[]>(() => {
        try {
            const all = Object.values(ChannelStore.getMutablePrivateChannels()) as any[];
            return all.filter(c => c.type === 3).map(c => ({ id: c.id, name: c.name || "Groupe sans nom" }));
        } catch { return []; }
    }, []);

    const messageableChannels = useMemo(() => [...dmChannels, ...groupChannels], [dmChannels, groupChannels]);

    const servers = useMemo<PickableEntry[]>(() => {
        try {
            const guilds = Object.values(GuildStore.getGuilds()) as any[];
            return guilds.map(g => ({
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
            })).sort((a, b) => a.name.localeCompare(b.name));
        } catch { return []; }
    }, []);

    const friends = useMemo<PickableEntry[]>(() => {
        try {
            const ids: string[] = RelationshipStoreLazy.getFriendIDs?.() ?? [];
            return ids.map(id => {
                const u = UserStoreLazy.getUser(id);
                return {
                    id,
                    name: u?.globalName || u?.username || id,
                    icon: u?.avatar ? `https://cdn.discordapp.com/avatars/${id}/${u.avatar}.png?size=64` : null,
                };
            }).sort((a, b) => a.name.localeCompare(b.name));
        } catch { return []; }
    }, []);

    // Tout coché par défaut (= sera supprimé) dès que ces listes sont prêtes.
    useEffect(() => { setKeptServers(new Set()); }, [servers.length]);
    useEffect(() => { setKeptFriends(new Set()); }, [friends.length]);

    function toggleKeep(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
        const next = new Set(set);
        if (next.has(id)) next.delete(id); else next.add(id);
        setter(next);
    }

    const anyEnabled = profileEnabled || messagesEnabled || closeDMsEnabled || leaveGroupsEnabled || serversEnabled || friendsEnabled;

    function buildPlan(): CleanerPlan {
        return {
            resetProfile: profileEnabled ? profileOptions : null,
            cleanMessages: messagesEnabled ? messageableChannels : null,
            closeDMs: closeDMsEnabled ? dmChannels : null,
            leaveGroups: leaveGroupsEnabled ? groupChannels : null,
            leaveServers: serversEnabled ? servers.filter(s => !keptServers.has(s.id)) : null,
            removeFriends: friendsEnabled ? friends.filter(f => !keptFriends.has(f.id)) : null,
        };
    }

    function handleRunClick() {
        if (isRunning) return;
        if (!confirmArmed) {
            setConfirmArmed(true);
            setTimeout(() => setConfirmArmed(false), 4000);
            return;
        }
        setConfirmArmed(false);
        runPlan(buildPlan());
    }

    return (
        <ModalRoot {...rootProps} size="large" className="cln-root">
            <ModalHeader separator={false}>
                <div className="cln-header-icon"><CleanerIcon width={22} height={22} /></div>
                <div className="cln-header-text">
                    <Forms.FormTitle tag="h4" style={{ margin: 0, color: "#fff" }}>Cleaner</Forms.FormTitle>
                    <Forms.FormText className="cln-header-subtitle">
                        Remet ton compte à un état proche de l'origine, en une seule passe organisée.
                    </Forms.FormText>
                </div>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>

            <ModalContent className="cln-content">
                <ProfileSection
                    enabled={profileEnabled}
                    onEnabledChange={setProfileEnabled}
                    options={profileOptions}
                    onOptionsChange={setProfileOptions}
                />

                <SimpleToggleSection
                    title="Nettoyer les messages en MP"
                    subtitle="Supprime tous tes messages dans chaque conversation et groupe"
                    enabled={messagesEnabled}
                    onEnabledChange={setMessagesEnabled}
                    count={messageableChannels.length}
                />

                <SimpleToggleSection
                    title="Fermer tous les MP"
                    subtitle="Ferme chaque conversation privée une par une"
                    enabled={closeDMsEnabled}
                    onEnabledChange={setCloseDMsEnabled}
                    count={dmChannels.length}
                />

                <SimpleToggleSection
                    title="Quitter tous les groupes"
                    subtitle="Quitte chaque groupe privé une par un"
                    enabled={leaveGroupsEnabled}
                    onEnabledChange={setLeaveGroupsEnabled}
                    count={groupChannels.length}
                />

                <PickableSection
                    title="Quitter les serveurs"
                    subtitle="Décoche ceux que tu veux garder"
                    enabled={serversEnabled}
                    onEnabledChange={setServersEnabled}
                    entries={servers}
                    kept={keptServers}
                    onToggleKeep={id => toggleKeep(keptServers, setKeptServers, id)}
                    placeholder="Chercher un serveur..."
                />

                <PickableSection
                    title="Supprimer les amis"
                    subtitle="Décoche ceux que tu veux garder"
                    enabled={friendsEnabled}
                    onEnabledChange={setFriendsEnabled}
                    entries={friends}
                    kept={keptFriends}
                    onToggleKeep={id => toggleKeep(keptFriends, setKeptFriends, id)}
                    placeholder="Chercher un ami..."
                />
            </ModalContent>

            <ModalFooter className="cln-footer">
                {(isRunning || runStatus) && (
                    <div className="cln-progress">
                        <div className="cln-progress-top">
                            <strong>{runStatus?.label ?? "En attente"}</strong>
                            <span>{runStatus?.detail ?? ""}</span>
                        </div>
                        <div className="cln-progress-bar">
                            <div className="cln-progress-fill" style={{ width: `${runStatus?.percentage ?? 0}%` }} />
                        </div>
                    </div>
                )}
                <div className="cln-footer-actions">
                    {isRunning ? (
                        <button className="cln-btn cln-btn--stop" onClick={stopRun}>Arrêter</button>
                    ) : (
                        <button
                            className={`cln-btn cln-btn--run ${confirmArmed ? "cln-btn--confirm" : ""}`}
                            onClick={handleRunClick}
                            disabled={!anyEnabled}
                        >
                            {confirmArmed ? "Confirmer ? Cliquer à nouveau" : "Lancer le nettoyage"}
                        </button>
                    )}
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function CleanerHeaderButton() {
    return (
        <HeaderBarButton
            icon={CleanerIcon}
            tooltip="Cleaner"
            onClick={() => openModal(props => <CleanerModal rootProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "Cleaner",
    enabledByDefault: false,
    description: "Remet ton compte à un état proche de l'origine en une seule passe : profil, messages en MP, fermeture des MP, sortie des groupes/serveurs, suppression des amis — avec listes 'à garder' et délais anti rate-limit.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["HeaderBarAPI"],

    headerBarButton: {
        icon: CleanerIcon,
        render: CleanerHeaderButton,
        priority: 4,
    },

    stop() {
        stopRun();
    },
});
