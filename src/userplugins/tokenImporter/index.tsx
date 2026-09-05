/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { DataStore } from "@api/index";
import { HeaderBarButton } from "@api/HeaderBar";
import { CopyIcon, DeleteIcon, FolderIcon, OpenExternalIcon, ShieldIcon } from "@components/Icons";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { PluginNative } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { findByProps } from "@webpack";
import { Button, Forms, IconUtils, React, TabBar, Toasts, useEffect, useState } from "@webpack/common";

// ─────────────────────────────────────────────────────────────────────────────
// TokenImporter — ajoute/bascule entre TES PROPRES comptes Discord via un token
// que tu possèdes déjà (copié depuis les DevTools, un ancien export, etc.).
//
// Volontairement absent de ce plugin : tout scan du disque à la recherche de
// tokens dans d'autres applications (Discord Canary/PTB, BetterDiscord, etc.)
// et tout déchiffrement de clés OS (DPAPI ou autre). Coller un token qu'on
// possède déjà pour se reconnecter est une chose ; aller le chercher soi-même
// dans les fichiers d'autres logiciels en est une autre — ce plugin ne fait
// que la première.
// ─────────────────────────────────────────────────────────────────────────────

const cl = classNameFactory("vc-tokenimporter-");

const Native = VencordNative.pluginHelpers.TokenImporter as PluginNative<typeof import("./native")>;

const STORE_KEY = "tokenimporter-accounts";
const ENC_PREFIX = "ti-enc:";
const TOKEN_REGEX = /(?:mfa\.[\w-]{84}|[\w-]{24,26}\.[\w-]{4,7}\.[\w-]{27,40})/g;

export interface SavedAccount {
    id: string;
    token: string;
    username: string;
    discriminator: string;
    avatar: string;
}

interface CheckResult {
    valid: boolean;
    user?: { id: string; username: string; global_name?: string; discriminator?: string; avatar?: string; };
    error?: string;
}

function extractTokens(raw: string): string[] {
    const found = new Set<string>();
    TOKEN_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_REGEX.exec(raw)) !== null) found.add(m[0]);
    return Array.from(found);
}

export async function getAccounts(): Promise<SavedAccount[]> {
    const raw = (await DataStore.get<SavedAccount[]>(STORE_KEY)) ?? [];
    const out: SavedAccount[] = [];
    for (const acc of raw) {
        let tok = acc.token;
        if (tok.startsWith(ENC_PREFIX)) {
            const dec = await Native.decryptToken(tok.slice(ENC_PREFIX.length));
            if (dec) tok = dec;
        }
        out.push({ ...acc, token: tok });
    }
    return out;
}

async function saveAccounts(accounts: SavedAccount[]): Promise<void> {
    const unique = new Map<string, SavedAccount>();
    for (const a of accounts) unique.set(a.id, a);

    const encrypted: SavedAccount[] = [];
    for (const a of unique.values()) {
        const enc = await Native.encryptToken(a.token);
        encrypted.push({ ...a, token: enc ? ENC_PREFIX + enc : a.token });
    }
    await DataStore.set(STORE_KEY, encrypted);
}

function switchToAccount(token: string) {
    try {
        const TokenStore = findByProps("getToken", "setToken");
        const FluxDispatcher = findByProps("dispatch", "subscribe", "register");

        if (TokenStore && typeof (TokenStore as any).setToken === "function") {
            (TokenStore as any).setToken(token);
        }

        // Réinitialise l'état de connexion interne de Discord — sans ces deux
        // dispatches, setToken seul ne suffit pas : le client garde l'ancienne
        // session en mémoire jusqu'au prochain vrai cycle de connexion.
        FluxDispatcher?.dispatch?.({
            type: "CONNECTION_OPEN",
            user: {},
            experiments: [],
            guilds: [],
            relationships: [],
            private_channels: [],
            users: [],
            analytics_token: "",
            session_id: "",
        });
        FluxDispatcher?.dispatch?.({ type: "LOGIN_SUCCESS", token });

        // Discord relit le token depuis localStorage au démarrage ; l'écrire
        // aussi dans un iframe détaché couvre le cas où le storage du process
        // de rendu n'est pas encore synchronisé au moment du reload.
        window.localStorage.setItem("token", `"${token}"`);
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        document.body.appendChild(iframe);
        try {
            (iframe as any).contentWindow.localStorage.token = `"${token}"`;
        } catch { }
        document.body.removeChild(iframe);

        setTimeout(() => Native.reload(), 350);
    } catch (e) {
        console.error("[TokenImporter] switch failed:", e);
        Native.reload();
    }
}

// Enregistre les comptes sauvegardés dans le sélecteur multi-comptes natif de
// Discord, via son propre mécanisme interne (l'action Flux que Discord envoie
// lui-même après une connexion validée). Ne fait que déclarer des comptes dont
// on possède déjà le token — ne lit ni ne modifie aucun autre compte.
function injectIntoNativeSwitcher(accounts: SavedAccount[]) {
    try {
        const FluxDispatcher = findByProps("dispatch", "subscribe");
        const tokenMod = findByProps("getToken", "encryptAndStoreTokens");

        for (const acc of accounts) {
            if (!acc.id || !acc.token) continue;
            FluxDispatcher?.dispatch?.({
                type: "MULTI_ACCOUNT_VALIDATE_TOKEN_SUCCESS",
                userId: acc.id,
                token: acc.token,
                user: {
                    id: acc.id,
                    username: acc.username,
                    discriminator: acc.discriminator ?? "0",
                    avatar: acc.avatar,
                    global_name: acc.username,
                    public_flags: 0,
                },
            });
        }

        if (tokenMod) {
            const tokensObj: Record<string, string> =
                (typeof (tokenMod as any).getTokens === "function" ? (tokenMod as any).getTokens() : (tokenMod as any).tokens) || {};
            let changed = false;
            for (const acc of accounts) {
                if (acc.id && acc.token && tokensObj[acc.id] !== acc.token) {
                    tokensObj[acc.id] = acc.token;
                    changed = true;
                }
            }
            if (changed && typeof (tokenMod as any).encryptAndStoreTokens === "function") {
                (tokenMod as any).encryptAndStoreTokens(tokensObj);
            }
        }
    } catch (e) {
        console.error("[TokenImporter] injectIntoNativeSwitcher failed:", e);
    }
}

function copyMyToken() {
    try {
        const token = findByProps("getToken")?.getToken?.();
        if (!token) return;
        copyToClipboard(token);
        Toasts.show({ message: "Token copié", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    } catch { }
}

// ── Onglet "Comptes locaux" ────────────────────────────────────────────────────
// Guidé, pas automatique : on ne lit aucun fichier des autres installs
// Discord/Canary/PTB (ce serait la même technique que les vols de token) — on
// se contente d'ouvrir l'appli et de copier le script à coller toi-même dans
// SA console pour récupérer TON propre token, comme le bouton "Copier mon
// token actuel" le fait déjà pour cette fenêtre-ci.
const LOCAL_INSTALL_TARGETS = [
    { label: "Discord", uri: "discord://" },
    { label: "Discord Canary", uri: "discordcanary://" },
    { label: "Discord PTB", uri: "discordptb://" },
];

const TOKEN_GRAB_SCRIPT = `(function() {
    window.webpackChunkdiscord_app.push([
        [Symbol()],
        {},
        req => {
            if (!req.c) return;
            for (const m of Object.values(req.c)) {
                try {
                    if (!m.exports || m.exports === window) continue;
                    if (m.exports?.getToken) return copy(m.exports.getToken());
                    for (const ex in m.exports) {
                        if (m.exports?.[ex]?.getToken) return copy(m.exports[ex].getToken());
                    }
                } catch {}
            }
        },
    ]);
    window.webpackChunkdiscord_app.pop();
    console.log("Token copié dans le presse-papier !");
})();`;

function openLocalInstall(uri: string) {
    try {
        window.open(uri, "_blank");
    } catch (e) {
        console.error("[TokenImporter] Failed to open install:", e);
    }
}

function LocalInstallsTab() {
    return (
        <div className={cl("tab-content")}>
            <Forms.FormText className={cl("hint")}>
                Récupère ton token depuis une autre installation déjà connectée, sans quitter cette fenêtre.
                Ouvre l'appli, colle le script dans sa console (Ctrl+Shift+I), puis colle le résultat dans
                l'onglet "Ajouter un token".
            </Forms.FormText>
            <div className={cl("list")}>
                {LOCAL_INSTALL_TARGETS.map(target => (
                    <div key={target.label} className={cl("row")}>
                        <div className={cl("row-info")}>
                            <span className={cl("username")}>{target.label}</span>
                            <span className={cl("token-hidden")}>Console → coller le script → copier le résultat</span>
                        </div>
                        <div className={cl("row-actions")}>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => openLocalInstall(target.uri)}>
                                Ouvrir
                            </Button>
                            <button
                                className={cl("icon-btn")}
                                title="Copier le script pour la console"
                                onClick={() => {
                                    copyToClipboard(TOKEN_GRAB_SCRIPT);
                                    Toasts.show({ message: "Script copié — colle-le dans la console de " + target.label, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                                }}
                            >
                                <CopyIcon width={17} height={17} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function avatarUrl(a: { id: string; avatar: string; discriminator: string; }): string {
    if (a.avatar) {
        return IconUtils.getUserAvatarURL({ id: a.id, avatar: a.avatar } as any, false, 64) ?? IconUtils.getDefaultAvatarURL(a.id, a.discriminator);
    }
    return IconUtils.getDefaultAvatarURL(a.id, a.discriminator);
}

// Petits badges de statut (rond coloré + glyphe blanc), pour la liste de
// résultats de vérification — plus lisible qu'une icône colorée flottant nue
// à côté du texte.
function CheckIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="9" fill="var(--status-positive-background, var(--text-positive))" />
            <path d="M5 9.2l2.4 2.4L13 6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
function CrossIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="9" fill="var(--status-danger-background, var(--text-danger))" />
            <path d="M6 6l6 6M12 6l-6 6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// Ouvre ce compte dans sa propre fenêtre Discord isolée, via le plugin
// MultiInstance (déclaré en dépendance ci-dessous). Le token ne quitte jamais
// cette machine : MultiInstance se contente de le poser dans le localStorage
// d'une nouvelle session Electron dédiée à ce compte.
function openInStandaloneInstance(a: SavedAccount) {
    try {
        const mi = (window as any).VencordNative?.pluginHelpers?.MultiInstance;
        if (!mi?.openInstanceWindow) {
            Toasts.show({ message: "Le plugin MultiInstance doit être activé", type: Toasts.Type.FAILURE, id: Toasts.genId() });
            return;
        }
        mi.openInstanceWindow(a.token, a.id, a.username);
    } catch (e) {
        console.error("[TokenImporter] openInStandaloneInstance failed:", e);
    }
}

const enum Tab {
    Saved,
    Add,
    Local
}

// ── Onglet "Comptes enregistrés" ───────────────────────────────────────────────
function SavedAccountsTab({ accounts, loaded, onRemove }: {
    accounts: SavedAccount[];
    loaded: boolean;
    onRemove(id: string): void;
}) {
    return (
        <div className={cl("tab-content")}>
            <Button
                size={Button.Sizes.SMALL}
                look={Button.Looks.OUTLINED}
                color={Button.Colors.PRIMARY}
                className={cl("my-token-btn")}
                onClick={copyMyToken}
            >
                <CopyIcon width={16} height={16} /> Copier mon token actuel
            </Button>

            {!loaded ? (
                <Forms.FormText className={cl("empty")}>Chargement...</Forms.FormText>
            ) : accounts.length === 0 ? (
                <Forms.FormText className={cl("empty")}>Aucun compte — ajoute un token dans l'onglet "Ajouter un token".</Forms.FormText>
            ) : (
                <div className={cl("list")}>
                    {accounts.map(a => (
                        <div key={a.id} className={cl("row")}>
                            <img className={cl("avatar")} src={avatarUrl(a)} alt="" />
                            <div className={cl("row-info")}>
                                <span className={cl("username")}>
                                    {a.username}{a.discriminator && a.discriminator !== "0" ? `#${a.discriminator}` : ""}
                                </span>
                                <span className={cl("token-hidden")}>•••• •••• •••• ••••</span>
                            </div>
                            <div className={cl("row-actions")}>
                                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => switchToAccount(a.token)}>
                                    Basculer
                                </Button>
                                <button className={cl("icon-btn")} title="Ouvrir dans une nouvelle fenêtre" onClick={() => openInStandaloneInstance(a)}>
                                    <OpenExternalIcon width={17} height={17} />
                                </button>
                                <button className={cl("icon-btn")} title="Copier le token" onClick={() => {
                                    copyToClipboard(a.token);
                                    Toasts.show({ message: "Token copié", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                                }}>
                                    <CopyIcon width={17} height={17} />
                                </button>
                                <button className={cl("icon-btn", "icon-btn--danger")} title="Supprimer" onClick={() => onRemove(a.id)}>
                                    <DeleteIcon width={17} height={17} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Onglet "Ajouter un token" ──────────────────────────────────────────────────
function AddTokenTab({ onAdded }: { onAdded(accounts: SavedAccount[]): void; }) {
    const [paste, setPaste] = useState("");
    const [detected, setDetected] = useState(0);
    const [checking, setChecking] = useState(false);
    const [results, setResults] = useState<{ token: string; status: "valid" | "invalid"; username?: string; }[]>([]);

    function handlePasteChange(val: string) {
        setPaste(val);
        setDetected(extractTokens(val).length);
    }

    async function verifyAndAdd() {
        const tokens = extractTokens(paste);
        if (!tokens.length) return;
        setChecking(true);
        setResults([]);
        const existing = await getAccounts();
        const newResults: { token: string; status: "valid" | "invalid"; username?: string; }[] = [];

        for (const tok of tokens) {
            let r: CheckResult;
            try { r = await Native.checkToken(tok); } catch { r = { valid: false }; }
            if (r.valid && r.user) {
                const u = r.user;
                if (!existing.find(a => a.id === u.id)) {
                    existing.push({
                        id: u.id,
                        token: tok,
                        username: u.global_name || u.username,
                        discriminator: u.discriminator ?? "0",
                        avatar: u.avatar ?? "",
                    });
                }
                newResults.push({ token: tok, status: "valid", username: u.global_name || u.username });
            } else {
                newResults.push({ token: tok, status: "invalid" });
            }
        }

        await saveAccounts(existing);
        injectIntoNativeSwitcher(existing);
        onAdded(existing);
        setResults(newResults);
        setPaste("");
        setDetected(0);
        setChecking(false);
    }

    return (
        <div className={cl("tab-content")}>
            <Forms.FormText className={cl("hint")}>Colle un ou plusieurs de TES tokens Discord (un par ligne).</Forms.FormText>
            <textarea
                className={cl("textarea")}
                value={paste}
                onChange={e => handlePasteChange(e.currentTarget.value)}
                placeholder="eyJhbGciOi... (un token par ligne)"
                rows={5}
            />
            <div className={cl("add-footer")}>
                <span className={cl("detected")}>{detected} token{detected !== 1 ? "s" : ""} détecté{detected !== 1 ? "s" : ""}</span>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.BRAND}
                    disabled={checking || detected === 0}
                    onClick={verifyAndAdd}
                >
                    {checking ? "Vérification..." : "Vérifier & ajouter"}
                </Button>
            </div>
            {results.length > 0 && (
                <div className={cl("results")}>
                    {results.map((r, i) => (
                        <div key={i} className={cl("result-row", r.status === "valid" ? "result-row--valid" : "result-row--invalid")}>
                            {r.status === "valid" ? <CheckIcon /> : <CrossIcon />}
                            <span>{r.status === "valid" ? r.username : "Token invalide"}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function TokenImporterModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [tab, setTab] = useState<Tab>(Tab.Saved);
    const [accounts, setAccounts] = useState<SavedAccount[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        getAccounts().then(v => { setAccounts(v); setLoaded(true); });
    }, []);

    async function removeAccount(id: string) {
        const updated = accounts.filter(a => a.id !== id);
        setAccounts(updated);
        await saveAccounts(updated);
    }

    return (
        <ModalRoot {...modalProps} size="large" className={cl("root")}>
            <ModalHeader separator={false} className={cl("header")}>
                <div className={cl("header-icon")}><ShieldIcon width={20} height={20} /></div>
                <div className={cl("header-text")}>
                    <Forms.FormTitle tag="h4" className={cl("title")}>Token Importer</Forms.FormTitle>
                    <Forms.FormText className={cl("subtitle")}>
                        Ajoute ou bascule entre tes comptes via un token que tu possèdes déjà
                    </Forms.FormText>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <TabBar
                type="top"
                look="brand"
                className={cl("tab-bar")}
                selectedItem={tab}
                onItemSelect={setTab}
            >
                <TabBar.Item className={cl("tab", { selected: tab === Tab.Saved })} id={Tab.Saved}>
                    Comptes enregistrés{accounts.length > 0 ? ` (${accounts.length})` : ""}
                </TabBar.Item>
                <TabBar.Item className={cl("tab", { selected: tab === Tab.Add })} id={Tab.Add}>
                    Ajouter un token
                </TabBar.Item>
                <TabBar.Item className={cl("tab", { selected: tab === Tab.Local })} id={Tab.Local}>
                    Comptes locaux
                </TabBar.Item>
            </TabBar>

            <ModalContent className={cl("content")}>
                {tab === Tab.Saved && <SavedAccountsTab accounts={accounts} loaded={loaded} onRemove={removeAccount} />}
                {tab === Tab.Add && <AddTokenTab onAdded={setAccounts} />}
                {tab === Tab.Local && <LocalInstallsTab />}
            </ModalContent>
        </ModalRoot>
    );
}

function TokenImporterHeaderButton() {
    return (
        <HeaderBarButton
            icon={FolderIcon}
            tooltip="Token Importer"
            onClick={() => openModal(props => <TokenImporterModal modalProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "TokenImporter",
    description: "Ajoute ou bascule entre tes propres comptes Discord via un token que tu possèdes déjà, ou ouvre-les chacun dans sa propre fenêtre. Aucun scan du disque, aucun autre compte ni autre application n'est touché.",
    authors: [{ name: "0ctane", id: 0n }],
    dependencies: ["MultiInstance"],
    enabledByDefault: false,

    headerBarButton: {
        icon: FolderIcon,
        render: TokenImporterHeaderButton,
        priority: 10,
    },

    start() {
        // Réinscrit les comptes déjà sauvegardés dans le sélecteur natif de
        // Discord au démarrage, pour qu'ils y réapparaissent après un redémarrage.
        getAccounts().then(injectIntoNativeSwitcher).catch(() => { });
    },
});
