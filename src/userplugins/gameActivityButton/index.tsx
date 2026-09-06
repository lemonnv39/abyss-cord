/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Remplacement en DOM pur du plugin stock (Equicord) GameActivityToggle.
 * Celui-ci dépend de UserAreaAPI, qui patche le code source de Discord pour
 * injecter des boutons dans le panneau compte — mais l'ancrage
 * (`.DISPLAY_NAME_STYLES_COACHMARK)`) ne matche plus : Discord a réorganisé
 * son découpage de modules, et cette chaîne vit maintenant dans une énorme
 * enum de "coachmarks" totalement séparée du composant qui rend réellement
 * le panneau. Plutôt que de rechasser un nouvel ancrage dans du JS minifié
 * (qui repourrirait à la prochaine mise à jour Discord), ce plugin repère le
 * panneau depuis le DOM affiché, qui change beaucoup moins souvent :
 * les deux groupes `[class*="audioButtonParent__"]` (micro, surdité)
 * partagent un parent commun — on y insère notre bouton juste avant
 * l'engrenage des paramètres. Seul le PRÉFIXE sémantique du nom de classe
 * CSS-module de Discord est utilisé (`audioButtonParent__`), jamais le
 * suffixe de hash qui change à chaque build.
 */

import { getUserSettingLazy } from "@api/UserSettings";
import definePlugin from "@utils/types";

const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

const BUTTON_ID = "abyss-game-activity-toggle";
const SVG_NS = "http://www.w3.org/2000/svg";

const GAME_PATH_D =
    "M3.06 20.4q-1.53 0-2.37-1.065T.06 16.74l1.26-9q.27-1.8 1.605-2.97T6.06 3.6h11.88q1.8 0 3.135 1.17t1.605 2.97l1.26 9q.21 1.53-.63 2.595T20.94 20.4q-.63 0-1.17-.225T18.78 19.5l-2.7-2.7H7.92l-2.7 2.7q-.45.45-.99.675t-1.17.225Zm14.94-7.2q.51 0 .855-.345T19.2 12q0-.51-.345-.855T18 10.8q-.51 0-.855.345T16.8 12q0 .51.345 .855T18 13.2Zm-2.4-3.6q.51 0 .855-.345T16.8 8.4q0-.51-.345-.855T15.6 7.2q-.51 0-.855.345T14.4 8.4q0 .51.345 .855T15.6 9.6ZM6.9 13.2h1.8v-2.1h2.1v-1.8h-2.1v-2.1h-1.8v2.1h-2.1v1.8h2.1v2.1Z";
const LINE_D = "M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4Z";

let observer: MutationObserver | null = null;

function buildIcon(showCurrentGame: boolean): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("viewBox", "0 0 24 24");

    // Même rouge que l'icône micro coupé (var(--icon-voice-muted)), pour un
    // rendu identique plutôt qu'un rouge approximatif choisi à la main.
    const color = showCurrentGame ? "#fff" : "var(--icon-voice-muted)";

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", GAME_PATH_D);
    path.setAttribute("fill", color);
    svg.appendChild(path);

    if (!showCurrentGame) {
        const line = document.createElementNS(SVG_NS, "path");
        line.setAttribute("d", LINE_D);
        line.setAttribute("fill", color);
        svg.appendChild(line);
    }

    return svg;
}

function refreshButton(btn: HTMLButtonElement) {
    const showCurrentGame = !!ShowCurrentGame.getSetting();
    const label = showCurrentGame ? "Disable Game Activity" : "Enable Game Activity";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.replaceChildren(buildIcon(showCurrentGame));
}

function makeButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    Object.assign(btn.style, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "0",
        width: "32px",
        height: "32px",
        flexShrink: "0",
    });
    btn.onclick = () => {
        ShowCurrentGame.updateSetting(old => !old);
        refreshButton(btn);
    };
    refreshButton(btn);
    return btn;
}

function insertButton() {
    const existing = document.getElementById(BUTTON_ID);

    const groups = document.querySelectorAll('[class*="audioButtonParent__"]');
    if (groups.length === 0) {
        existing?.remove();
        return;
    }

    // Le premier groupe est le micro, le second la surdité — on s'insère
    // juste AVANT le micro (à sa gauche), pas après.
    const micGroup = groups[0] as HTMLElement;
    const container = micGroup.parentElement;
    if (!container) return;

    if (existing) {
        if (existing.nextElementSibling !== micGroup) {
            container.insertBefore(existing, micGroup);
        }
        return;
    }

    container.insertBefore(makeButton(), micGroup);
}

export default definePlugin({
    name: "GameActivityButton",
    enabledByDefault: false,
    description: "Adds a button next to the mic and deafen buttons to toggle game activity — DOM-based, doesn't rely on patching Discord's internal (and frequently changing) render code like the stock GameActivityToggle does.",
    authors: [{ name: "0ctane", id: 0n }],

    start() {
        insertButton();
        observer = new MutationObserver(() => insertButton());
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
        document.getElementById(BUTTON_ID)?.remove();
    },
});
