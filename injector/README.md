# Abyss Injector

Injecteur/patcheur de Discord pour [Abyss](../README.md), en **Tauri v2**
(Rust + Svelte 5/TypeScript). Projet **indépendant** du reste du repo : autre
stack, autres conventions, autre cycle de release. Voir la section
"Sous-projet : injector/" du [CLAUDE.md racine](../CLAUDE.md) pour le pourquoi.

## Prérequis

- [Rust](https://rustup.rs/) (stable) — `rustup-init.exe` sur Windows
- Node.js 22+ avec pnpm activé via corepack :
  ```bash
  corepack enable
  ```
- Les [prérequis Tauri pour Windows](https://v2.tauri.app/start/prerequisites/)
  (WebView2 — déjà présent sur Windows 10/11 à jour ; Visual Studio Build
  Tools avec le workload "Desktop development with C++")

## Lancer en dev

```bash
pnpm install
pnpm tauri dev
```

## Builder l'installeur Windows

```bash
pnpm tauri build
```

Le `.exe` NSIS sort dans `src-tauri/target/release/bundle/nsis/`.

## Icônes

Un logo minimal (`app-icon.svg`) est fourni comme point de départ. Pour
régénérer le set d'icônes complet (`src-tauri/icons/`) à partir d'un vrai
logo :

```bash
pnpm dlx @tauri-apps/cli icon chemin/vers/logo.png -o src-tauri/icons
```

## Système de mise à jour

Utilise le plugin officiel `tauri-plugin-updater`, pas de fetch GitHub
custom. Voir `src-tauri/src/updater.rs` (check silencieux au lancement,
n'installe jamais rien tout seul) et `src/lib/api/updater.ts` (check manuel +
téléchargement/installation déclenchés par un clic utilisateur).

### Générer la paire de clés de signature (une seule fois)

```bash
pnpm dlx @tauri-apps/cli signer generate -w ~/.tauri/abyss-injector.key
```

- La **clé privée** est écrite dans le fichier passé à `-w`
  (`~/.tauri/abyss-injector.key` ci-dessus, donc
  `C:\Users\<toi>\.tauri\abyss-injector.key` sur Windows). **Ne jamais la
  commit, ni son mot de passe.**
- La commande affiche la **clé publique** dans le terminal — c'est celle-là
  qu'il faut coller dans `src-tauri/tauri.conf.json`, champ
  `plugins.updater.pubkey` (actuellement un placeholder
  `REPLACE_ME_WITH_THE_PUBLIC_KEY_FROM_TAURI_SIGNER_GENERATE`).

### Configurer les secrets GitHub Actions

Une fois la clé générée :

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/abyss-injector.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

(la deuxième commande demande le mot de passe de façon interactive — ne pas
le passer en argument en clair sur la ligne de commande)

### Publier une release

```bash
git tag injector-v0.1.0
git push origin injector-v0.1.0
```

Le tag `injector-v*.*.*` déclenche `.github/workflows/release.yml` : build
Windows, création de la Release GitHub, upload de l'installeur NSIS et du
`latest.json` signé.

## Structure

```
injector/
├── src/                    → frontend Svelte 5 (runes, TypeScript)
│   ├── lib/
│   │   ├── components/     → ShinyButton, UpdateBanner, ...
│   │   ├── stores/         → état global (runes $state)
│   │   └── api/            → wrappers invoke() des commandes Tauri
│   └── App.svelte          → vue principale (onglets Accueil / Réglages)
├── src-tauri/               → backend Rust
│   ├── src/
│   │   ├── main.rs
│   │   ├── discord.rs      → détection des installs Discord
│   │   ├── asar.rs         → écriture du app.asar de stub
│   │   ├── patcher.rs      → commandes Tauri patch/unpatch
│   │   ├── dist_fetch.rs   → téléchargement du build public Abyss
│   │   ├── settings.rs     → persistance des réglages (override repo local)
│   │   └── updater.rs      → check silencieux au lancement
│   ├── capabilities/
│   └── tauri.conf.json
└── package.json
```

## Ce que fait réellement le patch

Porté de la logique Go de [Vencord/Installer](https://github.com/Vencord/Installer)
(`patcher.go` + `app_asar.go`) :

1. Détecte les installs Discord/PTB/Canary/Development (dossier `app-<version>`
   le plus récent sous chaque base connue).
2. `is_patched` == présence de `resources/_app.asar` (la sauvegarde de
   l'original).
3. **Patch** : tue le process Discord de la branche visée, renomme
   `app.asar` → `_app.asar`, écrit un `app.asar` de 2 fichiers
   (`index.js` qui fait `require("<patcher.js>")`, et un `package.json`
   minimal) au format binaire ASAR.
4. **Unpatch** : restaure `_app.asar` → `app.asar`.

## D'où vient `patcher.js` — partager l'injecteur à des amis

Deux sources possibles, gérées par `patcher.rs`/`dist_fetch.rs` :

- **Par défaut (cas d'un ami qui n'a QUE l'exe)** : téléchargé et mis en
  cache depuis la branche
  [`builds`](https://github.com/lemonnv39/abyss-cord/tree/builds) de ce
  repo — alimentée automatiquement par `.github/workflows/publish-dist.yml`
  à chaque push sur `main`. Aucun clone du repo, aucun Node/pnpm nécessaire
  côté ami — juste l'exe. Le cache vit dans le dossier de données de l'app
  (`%APPDATA%\cc.abyss.injector\dist\`) et n'est retéléchargé que si absent ou
  via le bouton "Mettre à jour le build Abyss" des Réglages.
- **Override dev (optionnel)** : si le champ "Dossier du repo Abyss" des
  Réglages est renseigné, l'injecteur utilise
  `<repo>/dist/desktop/patcher.js` à la place — utile pour tester un build
  local avant qu'il ne soit poussé sur `main`. Nécessite d'avoir buildé
  Abyss au moins une fois (`node scripts/build/build.mjs --disable-updater`).

Donc oui : `pnpm tauri build` produit un `.exe` autonome que tu peux
envoyer tel quel — tes amis n'ont besoin de rien d'autre pour patcher leur
Discord avec Abyss.
