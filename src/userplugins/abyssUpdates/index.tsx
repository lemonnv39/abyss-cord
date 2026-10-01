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
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Button, Forms, React } from "@webpack/common";
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

function UpdatesModal({ rootProps, items }: { rootProps: any; items: NewPlugin[]; }) {
    const n = items.length;
    return (
        <ModalRoot {...rootProps} size="small">
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h4" style={{ margin: 0, color: "#ffffff" }}>
                    Abyss — Mise à jour appliquée
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>

            <ModalContent>
                <Forms.FormText style={{ marginBottom: "12px", color: "var(--text-muted)" }}>
                    {n} nouveau{n > 1 ? "x" : ""} plugin{n > 1 ? "s" : ""} ajouté{n > 1 ? "s" : ""} à Abyss :
                </Forms.FormText>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingBottom: "8px" }}>
                    {items.map(p => (
                        <div
                            key={p.name}
                            style={{
                                padding: "10px 12px",
                                borderRadius: "8px",
                                background: "var(--background-secondary-alt, var(--background-secondary))",
                                border: "1px solid var(--background-modifier-accent)",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontWeight: 600, color: "var(--header-primary)" }}>{p.name}</span>
                                <span
                                    style={{
                                        fontSize: "10px",
                                        fontWeight: 700,
                                        letterSpacing: "0.03em",
                                        padding: "1px 6px",
                                        borderRadius: "999px",
                                        color: "#ffffff",
                                        background: "var(--brand-500, #5865f2)",
                                    }}
                                >NOUVEAU</span>
                            </div>
                            {p.description && (
                                <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "3px", lineHeight: 1.4 }}>
                                    {p.description}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </ModalContent>

            <ModalFooter>
                <Button onClick={rootProps.onClose}>Génial !</Button>
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
