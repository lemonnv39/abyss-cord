/*
 * Abyss, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * AbyssUpdates — pop-up « Quoi de neuf ».
 *
 * À chaque démarrage, compare la liste des plugins actuellement embarqués dans
 * la build à celle mémorisée au dernier lancement (DataStore). Si de nouveaux
 * plugins sont apparus — c.-à-d. qu'une mise à jour d'Abyss vient d'être
 * appliquée par l'injecteur — une modale les liste. Toujours actif (required)
 * pour que tous les utilisateurs voient les nouveautés après une MAJ.
 *
 * Premier lancement : aucun historique local. On considère alors comme
 * « nouveaux » les plugins de JUST_ADDED (ceux introduits dans la build
 * courante), pour que la pop-up s'affiche dès la première mise à jour ; les
 * fois suivantes la détection est entièrement automatique.
 */

import { get, set } from "@api/DataStore";
import { ModalContent, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";
import Plugins from "~plugins";

const DATA_KEY = "AbyssUpdates_knownPlugins";

// Plugins introduits dans la build courante — affichés dès la 1re MAJ même sans
// historique local. À mettre à jour quand on ajoute un plugin notable.
const JUST_ADDED = ["AbyssHelloWorld", "AbyssUpdateTest"];

// Ne jamais s'annoncer soi-même dans la liste des nouveautés.
const HIDDEN = new Set(["AbyssUpdates"]);

interface NewPlugin {
    name: string;
    description: string;
}

function allPluginNames(): string[] {
    return Object.values(Plugins)
        .map((p: any) => p?.name)
        .filter((n): n is string => typeof n === "string")
        .sort();
}

function describe(name: string): string {
    const p: any = (Plugins as any)[name];
    return p?.description ?? "";
}

const STYLE_ID = "abyss-updates-style";
const CSS = `
.abyss-up-root { overflow: hidden; }
.abyss-up-header {
    position: relative;
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 20px 20px 16px;
    overflow: hidden;
}
.abyss-up-header::before {
    content: "";
    position: absolute;
    top: -60px; right: -40px;
    width: 220px; height: 160px;
    background: radial-gradient(circle, rgba(139, 92, 246, 0.35), transparent 70%);
    filter: blur(14px);
    pointer-events: none;
}
.abyss-up-close {
    position: absolute;
    top: 14px; right: 14px;
    width: 30px; height: 30px;
    display: grid; place-items: center;
    border: none; border-radius: 8px;
    background: transparent; color: var(--interactive-normal);
    cursor: pointer; transition: background .15s, color .15s;
}
.abyss-up-close:hover { background: var(--background-modifier-hover); color: var(--interactive-hover); }
.abyss-up-icon {
    width: 42px; height: 42px; flex-shrink: 0;
    border-radius: 13px; display: grid; place-items: center; color: #fff;
    background: linear-gradient(145deg, #a78bfa, #7c3aed);
    box-shadow: 0 8px 22px rgba(124, 58, 237, 0.5);
    animation: abyss-up-pop .5s cubic-bezier(.16,1,.3,1) both;
}
.abyss-up-title {
    margin: 0; font-size: 19px; font-weight: 800; letter-spacing: -0.02em;
    background: linear-gradient(110deg, #ffffff 30%, #c4b5fd);
    -webkit-background-clip: text; background-clip: text; color: transparent;
}
.abyss-up-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-muted); }
.abyss-up-list { display: flex; flex-direction: column; gap: 10px; padding: 2px 20px 20px; }
.abyss-up-card {
    position: relative; display: flex; gap: 12px; align-items: flex-start;
    padding: 12px 13px; border-radius: 12px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-accent);
    opacity: 0; transform: translateY(10px);
    animation: abyss-up-in .45s cubic-bezier(.16,1,.3,1) forwards;
    transition: border-color .16s, background .16s, transform .16s;
}
.abyss-up-card:hover {
    border-color: rgba(167, 139, 250, 0.55);
    background: var(--background-secondary-alt, var(--background-tertiary));
    transform: translateY(-1px);
}
.abyss-up-ptile {
    width: 34px; height: 34px; flex-shrink: 0;
    border-radius: 9px; display: grid; place-items: center; color: #c4b5fd;
    background: rgba(139, 92, 246, 0.14);
    border: 1px solid rgba(139, 92, 246, 0.32);
}
.abyss-up-body { min-width: 0; flex: 1; }
.abyss-up-name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.abyss-up-name { font-weight: 700; font-size: 14px; color: var(--header-primary); }
.abyss-up-badge {
    font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em;
    padding: 2px 7px; border-radius: 999px; color: #fff;
    background: linear-gradient(135deg, #a78bfa, #7c3aed);
    box-shadow: 0 2px 8px rgba(124, 58, 237, 0.45);
}
.abyss-up-desc { font-size: 12.5px; color: var(--text-muted); margin-top: 3px; line-height: 1.45; }
.abyss-up-foot {
    display: flex; justify-content: flex-end;
    padding: 14px 20px 18px; border-top: 1px solid var(--background-modifier-accent);
}
.abyss-up-btn {
    border: none; cursor: pointer; font-weight: 700; font-size: 13.5px; color: #fff;
    padding: 9px 22px; border-radius: 10px;
    background: linear-gradient(135deg, #8b5cf6, #7c3aed);
    box-shadow: 0 5px 18px rgba(124, 58, 237, 0.45);
    transition: filter .15s, transform .1s;
}
.abyss-up-btn:hover { filter: brightness(1.12); }
.abyss-up-btn:active { transform: scale(.97); }
@keyframes abyss-up-in { to { opacity: 1; transform: none; } }
@keyframes abyss-up-pop { from { opacity: 0; transform: scale(.6) rotate(-12deg); } to { opacity: 1; transform: none; } }
`;

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
}

const SparkleIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.5l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.9L12 2.5z" />
        <path d="M18.5 14l.95 2.3 2.3.95-2.3.95-.95 2.3-.95-2.3-2.3-.95 2.3-.95L18.5 14z" opacity="0.85" />
    </svg>
);

const PuzzleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M10 3a2 2 0 0 1 4 0v.5a1 1 0 0 0 1.5.87A1.6 1.6 0 0 1 18 5.8a2 2 0 0 1-.37 1.1 1 1 0 0 0 .87 1.6H21a2 2 0 0 1 0 4h-.5a1 1 0 0 0-.87 1.5 1.6 1.6 0 0 1-1.43 2.5 2 2 0 0 1-1.1-.37 1 1 0 0 0-1.6.87V21a2 2 0 0 1-4 0v-.5a1 1 0 0 0-1.5-.87A1.6 1.6 0 0 1 6 18.2a2 2 0 0 1 .37-1.1 1 1 0 0 0-.87-1.6H3a2 2 0 0 1 0-4h.5a1 1 0 0 0 .87-1.5A1.6 1.6 0 0 1 5.8 7.5a2 2 0 0 1 1.1.37A1 1 0 0 0 8.5 7V5a2 2 0 0 1 1.5-2z" />
    </svg>
);

const CloseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
    </svg>
);

function UpdatesModal({ rootProps, items }: { rootProps: any; items: NewPlugin[]; }) {
    const n = items.length;
    return (
        <ModalRoot {...rootProps} size="small" className="abyss-up-root">
            <div className="abyss-up-header">
                <div className="abyss-up-icon"><SparkleIcon /></div>
                <div>
                    <h1 className="abyss-up-title">Quoi de neuf ?</h1>
                    <p className="abyss-up-sub">
                        {n} nouveau{n > 1 ? "x" : ""} plugin{n > 1 ? "s" : ""} ajouté{n > 1 ? "s" : ""} à Abyss
                    </p>
                </div>
                <button className="abyss-up-close" onClick={rootProps.onClose} aria-label="Fermer"><CloseIcon /></button>
            </div>

            <ModalContent>
                <div className="abyss-up-list">
                    {items.map((p, i) => (
                        <div key={p.name} className="abyss-up-card" style={{ animationDelay: `${i * 70}ms` }}>
                            <div className="abyss-up-ptile"><PuzzleIcon /></div>
                            <div className="abyss-up-body">
                                <div className="abyss-up-name-row">
                                    <span className="abyss-up-name">{p.name}</span>
                                    <span className="abyss-up-badge">NOUVEAU</span>
                                </div>
                                {p.description && <div className="abyss-up-desc">{p.description}</div>}
                            </div>
                        </div>
                    ))}
                </div>
            </ModalContent>

            <div className="abyss-up-foot">
                <button className="abyss-up-btn" onClick={rootProps.onClose}>Génial !</button>
            </div>
        </ModalRoot>
    );
}

function showUpdateModal(items: NewPlugin[]) {
    ensureStyle();
    openModal(props => <UpdatesModal rootProps={props} items={items} />);
}

export default definePlugin({
    name: "AbyssUpdates",
    required: true,
    description: "Affiche une pop-up « Quoi de neuf » listant les nouveaux plugins après chaque mise à jour d'Abyss.",
    authors: [{ name: "0ctane", id: 0n }],

    async start() {
        const current = allPluginNames();

        let known: string[] | undefined;
        try {
            known = await get<string[]>(DATA_KEY);
        } catch {
            known = undefined;
        }

        // Premier lancement : on simule un historique = tout sauf les plugins
        // tout juste ajoutés, afin que la pop-up apparaisse dès la 1re MAJ.
        if (!known) {
            known = current.filter(n => !JUST_ADDED.includes(n));
        }

        const knownSet = new Set(known);
        const added = current.filter(n => !knownSet.has(n) && !HIDDEN.has(n));

        // Mémorise l'état courant pour la prochaine comparaison.
        try {
            await set(DATA_KEY, current);
        } catch {
            // best-effort
        }

        if (added.length === 0) return;

        const items: NewPlugin[] = added.map(name => ({ name, description: describe(name) }));

        // Laisse l'UI de Discord se monter avant d'ouvrir la modale.
        setTimeout(() => {
            try {
                showUpdateModal(items);
            } catch (e) {
                console.error("[AbyssUpdates] impossible d'afficher la modale :", e);
            }
        }, 4000);
    },
});
