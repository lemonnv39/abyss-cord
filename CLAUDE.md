# Abyss — instructions projet

Abyss est un fork d'[Equicord](https://github.com/Equicord/Equicord) (lui-même
fork de [Vencord](https://github.com/Vendicated/Vencord)), un mod client pour
Discord. Ce fichier documente la structure réelle du repo et les règles à
suivre pour toute intervention future.

## Pourquoi ce repo n'est PAS réorganisé "from scratch"

Sur les ~1750 fichiers de `src/`, environ 1116 appartiennent au code
**upstream** (Vencord + Equicord) et ne sont pas à nous. Réorganiser cette
partie casserait toute possibilité de resynchroniser avec l'upstream et
apporterait un risque énorme pour zéro bénéfice fonctionnel. Le reorg de ce
repo s'est donc volontairement limité à : la documentation racine, et la
zone qui est réellement la nôtre (`src/userplugins/`). Le reste de
l'architecture Vencord/Equicord reste exactement où l'upstream le place.

## Structure du projet

| Dossier | Rôle | À qui appartient le code |
|---|---|---|
| `src/userplugins/` | **Nos plugins custom.** Un dossier par plugin (`src/userplugins/<nom>/index.tsx` + `native.ts`/`styles.css` optionnels). | Nous — zone principale d'intervention |
| `src/plugins/` | Plugins stock **Vencord** (upstream) | Upstream — ne pas modifier sauf patch ciblé et documenté |
| `src/equicordplugins/` | Plugins stock **Equicord** (upstream) | Upstream — idem |
| `src/main/` | Process principal Electron : IPC, patch de l'app hôte, tray, `csp/` | Upstream (structure), nos ajouts dedans (ex: `patcher.ts` contient nos flags perf) |
| `src/main/updater/` | Système de check/download des mises à jour (GitHub Releases) | Upstream — **ne jamais modifier sans demande explicite** (voir règle ci-dessous) |
| `src/webpack/` | Intercepteur/patcheur des modules webpack de Discord | Upstream |
| `src/api/` | API de plugins (settings, notifications, context menu, badges, HeaderBar…) | Upstream + nos extensions (ex: `api/HeaderBar.tsx` a été étendu pour CompactMode/StealthMode) |
| `src/components/` | Composants React partagés (UI settings, boutons…) | Upstream |
| `src/utils/` | Utilitaires renderer | Upstream |
| `src/shared/` | Utilitaires partagés main/renderer | Upstream |
| `scripts/` | Outillage : build (`scripts/build/`), injecteur (`runInstaller.mjs`), génération de listes/rapports | Upstream (ne pas modifier sans raison précise) |
| `browser/` | Build pour extension navigateur (hors scope desktop) | Upstream |
| `dist/` | Sortie de build — généré, jamais versionné, jamais édité à la main | — |
| `graphify-out/` | Sortie d'un outil d'analyse de code — généré, ignoré par git | — |

### L'injecteur, concrètement

Il n'y a pas de dossier `injector/` isolé : le mécanisme d'injection est
réparti entre `src/main/patcher.ts` (bootstrap qui charge Abyss avant
Discord), `scripts/runInstaller.mjs` (CLI `pnpm inject`/`uninject`/`repair`),
et la technique de stub `app.asar` (un `app.asar` transformé en dossier avec
un `index.js` qui fait `require(".../dist/desktop/patcher.js")`, appliquée
en dehors de ce repo directement dans les installations Discord/Canary).

## Règles

1. **Un plugin = un dossier isolé dans `src/userplugins/`.** Jamais de
   fichier de plugin custom ailleurs (pas de logique métier dans
   `src/components/` ou `src/utils/` pour un plugin spécifique — si besoin
   de code partagé entre plugins custom, créer un sous-dossier dédié plutôt
   que de le mélanger dans l'arborescence upstream).

2. **Ne jamais modifier `src/main/updater/`, `scripts/runInstaller.mjs`, ou
   le mécanisme de stub `app.asar` sans demande explicite de l'utilisateur.**
   Ce sont des zones sensibles (mise à jour, injection) où une erreur peut
   casser l'installation entière ou la capacité à se mettre à jour. Toute
   autre modification de `src/main/` (hors `updater/`) reste soumise au bon
   sens habituel, mais celles-ci demandent un accord explicite au préalable.

3. **Après chaque modification fonctionnelle** (nouveau plugin, fix, feature,
   suppression) : mettre à jour `CHANGELOG.md` (section `[Unreleased]` avec
   `Added`/`Fixed`/`Changed`/`Removed`) et **proposer** un bump de
   `version.json` en semver (patch pour un fix, minor pour une feature,
   major pour un changement cassant) — proposer, pas appliquer sans
   confirmation si le changement est ambigu en termes d'impact.

4. **Convention de commit** : `type(scope): description`
   (ex : `feat(dmProof): blur taskbar overlay icon`,
   `fix(followUser): use MediaEngine for setOutputVolume`,
   `chore(deps): reinstall usercss-meta`). Types usuels : `feat`, `fix`,
   `chore`, `docs`, `refactor`, `perf`.

## Contraintes de build à connaître

- Pas de binaires natifs `.node` dans les plugins (`external` dans
  `scripts/build/build.mjs` exclut electron/original-fs/`~pluginNatives` —
  JS/WASM pur uniquement).
- `definePlugin({ name: "..." ...})` : `name` doit être **littéralement la
  première propriété** (regex de `resolvePluginName` dans
  `scripts/build/common.mjs`).
- Build local : `node scripts/build/build.mjs --disable-updater`. Depuis le
  `git init`, `~git-hash`/`~git-remote` se résolvent tout seuls via le vrai
  `.git` (plus besoin des variables `EQUICORD_HASH`/`EQUICORD_REMOTE`
  factices utilisées avant). **`--disable-updater` est obligatoire** : sans
  lui, le check de mise à jour d'Abyss se compare au vrai repo upstream
  Equicord (ou à un `lemonnv39/abyss-cord` sans Release publiée) et se
  croit "en retard" en permanence → bannière "Abyss has been updated!"
  qui boucle à chaque restart (bug vécu et corrigé une fois, cf.
  `CHANGELOG.md`).
- Un changement dans un `native.ts` (process principal) exige un **restart
  complet** de Discord/Canary (pas juste Ctrl+R) — `patcher.js` n'est chargé
  qu'au démarrage d'Electron.
- Les deux installs (`Discord` et `DiscordCanary` dans
  `C:\ProgramData\lemonn\`) pointent vers le même
  `dist/desktop/patcher.js` via un stub `app.asar` — tout build local est
  donc immédiatement live sur les deux.
