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

import "./styles.css";

import { get, set } from "@api/DataStore";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Forms, React } from "@webpack/common";
import Plugins from "~plugins";

const STATE_KEY = "AbyssUpdates_state";

// Bumpe ce numéro pour RÉ-ANNONCER JUST_ADDED à tout le monde au prochain
// lancement (utile pour mettre en avant un lot de nouveautés même chez ceux qui
// ont déjà l'historique). Sans bump, la détection reste purement automatique.
const ANNOUNCE_VERSION = 1;

// Plugins mis en avant pour l'annonce courante (affichés tant que ANNOUNCE_VERSION
// n'a pas encore été vu). À vider quand on ne veut plus d'annonce forcée.
const JUST_ADDED = ["AbyssHelloWorld", "AbyssUpdateTest"];

// Ne jamais s'annoncer soi-même dans la liste des nouveautés.
const HIDDEN = new Set(["AbyssUpdates"]);

interface StoredState {
    version: number;
    known: string[];
}

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

function UpdatesModal({ rootProps, items }: { rootProps: any; items: NewPlugin[]; }) {
    const n = items.length;
    return (
        <ModalRoot {...rootProps} size="small" className="aup-root">
            <ModalHeader separator={false}>
                <div className="aup-header-icon"><SparkleIcon /></div>
                <div className="aup-header-text">
                    <Forms.FormTitle tag="h4" style={{ margin: 0, color: "#fff" }}>Quoi de neuf ?</Forms.FormTitle>
                    <Forms.FormText className="aup-header-subtitle">
                        {n} nouveau{n > 1 ? "x" : ""} plugin{n > 1 ? "s" : ""} ajouté{n > 1 ? "s" : ""} à Abyss
                    </Forms.FormText>
                </div>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>

            <ModalContent className="aup-content">
                {items.map(p => (
                    <div key={p.name} className="aup-card">
                        <div className="aup-card-icon"><PuzzleIcon /></div>
                        <div className="aup-card-body">
                            <div className="aup-card-title-row">
                                <span className="aup-card-title">{p.name}</span>
                                <span className="aup-badge">Nouveau</span>
                            </div>
                            {p.description && <div className="aup-card-subtitle">{p.description}</div>}
                        </div>
                    </div>
                ))}
            </ModalContent>

            <ModalFooter className="aup-footer">
                <button className="aup-btn" onClick={rootProps.onClose}>Génial !</button>
            </ModalFooter>
        </ModalRoot>
    );
}

function showUpdateModal(items: NewPlugin[]) {
    openModal(props => <UpdatesModal rootProps={props} items={items} />);
}

export default definePlugin({
    name: "AbyssUpdates",
    required: true,
    description: "Affiche une pop-up « Quoi de neuf » listant les nouveaux plugins après chaque mise à jour d'Abyss.",
    authors: [{ name: "0ctane", id: 0n }],

    async start() {
        const current = allPluginNames();

        let state: StoredState | undefined;
        try {
            state = await get<StoredState>(STATE_KEY);
        } catch {
            state = undefined;
        }

        const isAnnounce = !state || state.version < ANNOUNCE_VERSION;

        let added: string[];
        if (isAnnounce) {
            // 1re fois OU nouvelle annonce : met en avant JUST_ADDED (encore
            // présents) + tout ce qui est apparu depuis l'historique connu.
            const prev = new Set(state?.known ?? []);
            const fromAnnounce = JUST_ADDED.filter(n => current.includes(n));
            const fromDiff = state?.known ? current.filter(n => !prev.has(n)) : [];
            added = [...new Set([...fromAnnounce, ...fromDiff])].filter(n => !HIDDEN.has(n));
        } else {
            // Fonctionnement normal : diff par rapport au dernier lancement.
            const prev = new Set(state!.known);
            added = current.filter(n => !prev.has(n) && !HIDDEN.has(n));
        }

        // Mémorise l'état courant (+ version d'annonce vue) pour la prochaine fois.
        try {
            await set(STATE_KEY, { version: ANNOUNCE_VERSION, known: current } satisfies StoredState);
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
