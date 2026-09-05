/*
 * Abyss — Micro studio
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Discord traite ton micro POUR LA VOIX : suppression de bruit, annulation
 * d'écho, gain automatique, Krisp. Sur de la parole c'est utile. Sur de la
 * musique c'est destructeur — une nappe tenue passe pour du bruit de fond et
 * se fait raboter, le gain pompe à chaque montée, Krisp mange les aigus.
 *
 * Ce plugin coupe ces traitements. TROIS RÈGLES, tirées d'une première
 * version qui débordait :
 *
 *  1. UNIQUEMENT LE MICRO. Les réglages sont appliqués aux connexions dont
 *     le `context` vaut "default" — c'est la connexion vocale, celle qui
 *     porte ta voix. Les connexions "stream" (partage d'écran, go live) ne
 *     sont jamais touchées.
 *
 *  2. RIEN D'AUTRE QUE DES APPELS DOCUMENTÉS. Pas de `setTransportOptions`
 *     ni de renégociation de connexion — c'est exactement ce qui, la fois
 *     d'avant, se répercutait sur tout le reste de Discord. Le débit vocal
 *     (`setVoiceBitRate`) est documenté et scopé à la connexion micro, donc
 *     safe ; le nombre de canaux (mono/stéréo) ne l'est pas — Discord ne
 *     l'expose nulle part dans son SDK vocal (négocié serveur), donc on n'y
 *     touche pas, quel que soit le réglage.
 *
 *  3. JAMAIS DE CONFIG PARTIELLE. `setAutomaticGainControl` attend un objet
 *     complet ; en laisser des champs indéfinis part vers du code natif. On
 *     fournit les dix champs documentés, on ne bascule que `enabled`.
 *
 * Réversible : l'état d'avant est relevé au démarrage et remis à l'arrêt.
 * Exception : le débit vocal n'a pas de getter exposé par Discord, donc on
 * ne peut pas relever sa valeur d'origine — désactiver le réglage n'abaisse
 * le débit qu'au prochain établissement de connexion (on ne rejoue rien sur
 * une connexion déjà active).
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { MediaEngineStore } from "@webpack/common";

/** Valeurs par défaut de `AutomaticGainControlConfig`, telles que documentées
 *  par le type. On les fournit toutes : un objet partiel laisserait des champs
 *  indéfinis côté natif (règle 3). */
const AGC_BASE = {
    enabled: true,
    useAGC2: true,
    enableAnalog: false,
    enableDigital: true,
    headroom_db: 5,
    max_gain_db: 50,
    initial_gain_db: 15,
    max_gain_change_db_per_second: 6,
    max_output_noise_level_dbfs: -50,
    fixed_gain_db: 0,
};

/** État relevé au démarrage, pour pouvoir tout remettre à l'arrêt. */
let avant: {
    echo: boolean;
    bruit: boolean;
    gain: boolean;
    krisp: boolean;
} | null = null;

const settings = definePluginSettings({
    sansSuppressionBruit: {
        type: OptionType.BOOLEAN,
        description: "Couper la suppression de bruit (elle prend les nappes tenues pour du bruit)",
        default: true,
        onChange: () => applique(),
    },
    sansAnnulationEcho: {
        type: OptionType.BOOLEAN,
        description: "Couper l'annulation d'écho (elle creuse le son quand ça sort de tes enceintes)",
        default: true,
        onChange: () => applique(),
    },
    sansGainAuto: {
        type: OptionType.BOOLEAN,
        description: "Couper le gain automatique (c'est lui qui fait pomper le volume)",
        default: true,
        onChange: () => applique(),
    },
    sansKrisp: {
        type: OptionType.BOOLEAN,
        description: "Couper Krisp (le filtre de bruit avancé — il mange les aigus)",
        default: true,
        onChange: () => applique(),
    },
    debitEleve: {
        type: OptionType.BOOLEAN,
        description: "Relever le débit vocal de TA connexion micro (son plus riche, moins compressé). N'affecte ni le partage d'écran ni les autres membres du salon.",
        default: false,
        onChange: () => applique(),
    },
    debitCibleKbps: {
        type: OptionType.SLIDER,
        description: "Débit visé en kbps (le salon peut plafonner plus bas selon son niveau de boost — Discord applique alors son propre maximum sans erreur).",
        markers: [64, 96, 128, 192, 256, 320, 384, 510],
        stickToMarkers: true,
        default: 128,
        onChange: () => applique(),
    },
});

let diagFait = false;

/** Diagnostic temporaire : liste les vraies méthodes de la connexion micro,
 *  pour vérifier si Discord expose highpass/stéréo avant d'écrire du code
 *  dessus. À retirer une fois la réponse obtenue. */
function diagnostic(c: any) {
    if (diagFait) return;
    diagFait = true;
    try {
        const methodes: string[] = [];
        let proto = c;
        while (proto && proto !== Object.prototype) {
            methodes.push(...Object.getOwnPropertyNames(proto));
            proto = Object.getPrototypeOf(proto);
        }
        const uniques = [...new Set(methodes)].sort();
        console.log("[MicroStudio][DIAG] Méthodes de connexion micro:", uniques);
        console.log("[MicroStudio][DIAG] Filtré highpass/stereo/channel:", uniques.filter(m => /highpass|stereo|channel/i.test(m)));
    } catch (e) {
        console.log("[MicroStudio][DIAG] échec:", e);
    }
}

/** Les connexions du MICRO, et elles seules (règle 1). */
function connexionsMicro(): any[] {
    try {
        const moteur: any = MediaEngineStore.getMediaEngine?.();
        const brut = moteur?.connections;
        if (!brut) return [];
        const liste = Array.from(brut as Iterable<any>).filter(
            c => c && c.context === "default" && !c.destroyed,
        );
        if (liste[0]) diagnostic(liste[0]);
        return liste;
    } catch {
        return [];
    }
}

/** Relève l'état actuel — une seule fois, pour pouvoir le restituer. */
function releve() {
    if (avant) return;
    try {
        const s: any = MediaEngineStore;
        avant = {
            echo: s.getEchoCancellation?.() ?? true,
            bruit: s.getNoiseSuppression?.() ?? true,
            gain: s.getAutomaticGainControl?.() ?? true,
            krisp: s.getNoiseCancellation?.() ?? true,
        };
    } catch {
        avant = { echo: true, bruit: true, gain: true, krisp: true };
    }
}

/**
 * Pose les réglages sur les connexions micro.
 * `actif = false` remet l'état d'avant (arrêt du plugin).
 *
 * Chaque appel est isolé : si une méthode manque sur cette version de
 * Discord, on saute ce réglage au lieu de faire tomber les autres.
 */
function applique(actif = true) {
    const s = settings.store;
    const voulu = actif
        ? {
            echo: !s.sansAnnulationEcho,
            bruit: !s.sansSuppressionBruit,
            gain: !s.sansGainAuto,
            krisp: !s.sansKrisp,
        }
        : (avant ?? { echo: true, bruit: true, gain: true, krisp: true });

    for (const c of connexionsMicro()) {
        pose(() => c.setEchoCancellation(voulu.echo));
        pose(() => c.setNoiseSuppression(voulu.bruit));
        pose(() => c.setNoiseCancellation(voulu.krisp));
        pose(() => c.setAutomaticGainControl({ ...AGC_BASE, enabled: voulu.gain }));

        // Débit vocal : setVoiceBitRate/setBitRate sont documentés et scopés à CETTE
        // connexion (règle 2) — contrairement à setTransportOptions, on ne renégocie
        // rien. Le serveur du salon plafonne lui-même si on vise plus haut que son
        // niveau de boost ne le permet ; pas de risque à viser large.
        if (actif && s.debitEleve) {
            const bps = Math.round((s.debitCibleKbps ?? 128) * 1000);
            pose(() => c.setVoiceBitRate(bps));
            pose(() => c.setBitRate(bps));
        }
    }
}

function pose(action: () => void) {
    try {
        action();
    } catch {
        /* réglage absent sur cette version : on laisse Discord décider */
    }
}

export default definePlugin({
    name: "MicroStudio",
    description:
        "Coupe les traitements que Discord applique à TON micro (suppression de bruit, écho, gain auto, Krisp) et relève en option le débit vocal — pour envoyer de la musique sans qu'elle soit rabotée. N'agit que sur ta connexion vocale : ni le partage d'écran, ni les autres membres du salon, ni le nombre de canaux ne sont touchés (ce dernier n'est de toute façon exposé nulle part par Discord — négocié serveur). Les réglages se posent en rejoignant un salon vocal.",
    tags: ["Voice", "Media"],
    authors: [{ name: "0ctane", id: 0n }],
    settings,

    start() {
        releve();
        applique(true);
    },

    stop() {
        applique(false);
        avant = null;
    },

    // On se raccroche aux événements plutôt que de détourner `connect` :
    // si un nom d'événement change, le plugin cesse simplement de se
    // réappliquer — alors qu'un détournement raté couperait le vocal.
    flux: {
        RTC_CONNECTION_STATE({ state }: { state: string; }) {
            if (state === "RTC_CONNECTED") applique(true);
        },
        VOICE_CHANNEL_SELECT() {
            applique(true);
        },
    },
});
